import { app } from "electron"
import { Context, Effect, FileSystem, Layer, Path } from "effect"
import { BackgroundServiceState } from "./background-service-state"
import { cleanStages, DesktopCli } from "./desktop-cli"
import { SidecarCredentials } from "./sidecar-credentials"
import { connectSessionLink, prepareSessionLink } from "./session-link"
import { profileBinding } from "@opencode/util/profile-binding"
import { Schema } from "effect"
import { writeFileSync, renameSync } from "node:fs"
import type { EnsureOptions } from "@opencode/client/service"

export * as BackgroundService from "./background-service"

export interface Interface {
  readonly connection: Effect.Effect<SidecarCredentials.Data>
  readonly reconnect: Effect.Effect<SidecarCredentials.Data>
}

export class Service extends Context.Service<Service, Interface>()("opencode/desktop/BackgroundService") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const context = yield* Effect.context<FileSystem.FileSystem | Path.Path | DesktopCli.Service>()

    return Service.of(
      yield* BackgroundServiceState.make({
        initial: connect("initial").pipe(Effect.provide(context)),
        reconnect: connect("reconnect").pipe(Effect.provide(context), Effect.orDie),
      }),
    )
  }),
)

const connect = Effect.fn("BackgroundService.connect")(function* (mode: "initial" | "reconnect") {
  yield* Effect.logInfo("starting v2 background service")
  const path = yield* Path.Path
  const desktopCli = yield* DesktopCli.Service
  const runFork = Effect.runForkWith(yield* Effect.context())
  const isolated = !app.isPackaged && process.env.OPENCODE_DESKTOP_ISOLATED_SERVER === "1"
  const cli = yield* desktopCli.resolve
  const linkEnvironment = yield* prepareSessionLink()
  const version = cli.version

  if (isolated) process.env.XDG_STATE_HOME = app.getPath("userData")
  const client = yield* Effect.promise(() => import("@opencode/client/service"))

  const ensure = (onContender?: EnsureOptions["onContender"]) =>
    client.Service.ensure({
      onContender,
      existingService: "preserve",
      file:
        profileBinding?.serviceRegistration ??
        (isolated && process.env.OPENCODE_DESKTOP_SERVER_CHANNEL === "local"
          ? path.join(app.getPath("userData"), "opencode", "service-local.json")
          : undefined),
      version,
      env: linkEnvironment,
      // A fixed port makes a second contender fail to bind and back off; port 0 never collides, so two
      // services could boot against the same database.
      command: [
        ...cli.command,
        "serve",
        "--service",
        ...(isolated ? ["--hostname", "0.0.0.0", "--port", String(0x0c0c)] : []),
      ],
      onStart: (reason, previousVersion) =>
        runFork(Effect.logInfo("v2 CLI background service starting", { reason, previousVersion })),
    })

  // A service with the required version is adopted at once; ensure() still runs
  // afterwards for its side effects (terminal handoff completion), off the renderer's path.
  const early =
    mode === "initial" && !isolated
      ? yield* Effect.promise(() => client.Service.discover({ version, file: profileBinding?.serviceRegistration }))
      : undefined

  if (early) yield* Effect.sync(() => void ensure().catch(() => undefined))
  const service = early ?? (yield* Effect.tryPromise(() => ensure()))

  if (service.auth?.type !== "basic") throw new Error("V2 CLI background service did not provide authentication")
  const url = new URL(service.url)

  if (url.hostname === "0.0.0.0") url.hostname = "127.0.0.1"
  yield* Effect.logInfo("v2 CLI background service ready", {
    version,
    probed: !!early,
    ...endpoint(url.origin),
  })

  if (mode === "initial" && isolated && cli.binary) yield* cleanStages(cli.binary).pipe(Effect.orDie)
  const ready = { url: url.origin, password: service.auth.password } satisfies SidecarCredentials.Data
  SidecarCredentials.set(ready)
  const link = yield* connectSessionLink(ready)

  if (
    mode === "initial" &&
    link.status === "unavailable" &&
    link.reason === "session-link-runtime-upgrade-required" &&
    profileBinding
  ) {
    const file = profileBinding.serviceRegistration
    const fs = yield* FileSystem.FileSystem
    const recovery = process.env.LINGXI_SERVICE_UPGRADE_RECOVERY

    if (!recovery || !process.env.LINGXI_LAUNCH_ATTEMPT || !process.env.LINGXI_PROFILE_DIGEST)
      throw new Error("Install the current Lingxi setup before applying this Session Link runtime update")

    const expected = Schema.decodeUnknownSync(
      Schema.fromJsonString(
        Schema.Struct({
          id: Schema.optional(Schema.String),
          version: Schema.String,
          url: Schema.String,
          pid: Schema.Int,
          password: Schema.String,
        }),
      ),
    )(yield* fs.readFileString(file))

    if (expected.url !== service.url || expected.version !== version || expected.password !== ready.password)
      throw new Error("Service registration changed before Session Link update")

    // Only a verified carrier from another immutable bundle of this installation
    // may request this transition. Observed active work blocks startup of the
    // candidate, leaving the launcher to use its compatible fallback. This is an
    // idle observation, not an atomic admission barrier for new input.
    const active = yield* Effect.tryPromise(async () => {
      const response = await fetch(new URL("/api/session/active", ready.url), {
        headers: { authorization: `Basic ${Buffer.from(`opencode:${ready.password}`).toString("base64")}` },
        signal: AbortSignal.timeout(10_000),
      })

      if (!response.ok) throw new Error("Could not verify service idleness for Session Link update")

      return Schema.decodeUnknownSync(Schema.Struct({ data: Schema.Record(Schema.String, Schema.Unknown) }))(
        await response.json(),
      ).data
    })

    if (Object.keys(active).length > 0) throw new Error("Session Link update is waiting for active sessions to finish")
    yield* Effect.logInfo("reloading idle bound service for Session Link runtime update")
    const contenders: number[] = []

    const note = {
      attemptId: process.env.LINGXI_LAUNCH_ATTEMPT,
      profileDigest: process.env.LINGXI_PROFILE_DIGEST,
      previousId: expected.id ?? null,
      previousPid: expected.pid,
      startedAt: new Date().toISOString(),
      pendingSpawn: false,
      contenders,
    }

    const save = () => {
      writeFileSync(recovery + ".tmp", JSON.stringify(note), { flush: true })
      renameSync(recovery + ".tmp", recovery)
    }

    yield* Effect.sync(save)
    yield* Effect.tryPromise(() => client.Service.stop({ file, expected, pty: "handoff" }))

    const replacement = yield* Effect.tryPromise(() =>
      ensure((event) => {
        note.pendingSpawn = event.phase === "starting"

        if (event.phase === "spawned" && event.pid !== undefined) note.contenders.push(event.pid)
        save()
      }),
    )

    if (replacement.auth?.type !== "basic") throw new Error("Updated service did not provide authentication")
    const resumed = { url: replacement.url, password: replacement.auth.password }
    SidecarCredentials.set(resumed)
    const connected = yield* connectSessionLink(resumed)

    if (connected.status !== "ready") throw new Error("Updated Session Link did not become ready")

    return resumed
  }

  return ready
})

function endpoint(url: string | undefined) {
  if (!url || !URL.canParse(url)) return {}
  const parsed = new URL(url)

  return { url, hostname: parsed.hostname, port: parsed.port }
}
