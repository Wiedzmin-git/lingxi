import { createHash } from "node:crypto"
import { readFile, rename, writeFile } from "node:fs/promises"
import { renameSync, writeFileSync } from "node:fs"
import { Schema } from "effect"
import { profileBinding } from "@opencode/util/profile-binding"
import type { EnsureOptions } from "@opencode/client/service"
import { nativeT } from "../native/translations"

const Plan = Schema.Struct({
  format: Schema.Literal(1),
  attemptId: Schema.String,
  bundleSha256: Schema.String,
  profileDigest: Schema.String,
  previousVersion: Schema.String,
  previousBackendSha256: Schema.String,
  backendVersion: Schema.String,
  registrationSha256: Schema.NullOr(Schema.String),
  previousRunning: Schema.Boolean,
})

const Registration = Schema.Struct({
  id: Schema.optional(Schema.String),
  version: Schema.String,
  url: Schema.String,
  pid: Schema.Int,
  password: Schema.String,
})

// The supervisor admits the exact tested bundle pair and attests the old executable.
// This separate path owns replacement; ordinary discovery always preserves a server.
export async function prepareBackendTransition(version: string): Promise<EnsureOptions["onContender"]> {
  const file = process.env.LINGXI_BACKEND_TRANSITION

  if (!file) return undefined

  const recovery = process.env.LINGXI_SERVICE_UPGRADE_RECOVERY
  const plan = Schema.decodeUnknownSync(Schema.fromJsonString(Plan))(await readFile(file, "utf8"))

  if (
    !profileBinding ||
    !recovery ||
    plan.attemptId !== process.env.LINGXI_LAUNCH_ATTEMPT ||
    plan.bundleSha256 !== process.env.LINGXI_BUNDLE_DIGEST ||
    plan.profileDigest !== process.env.LINGXI_PROFILE_DIGEST ||
    plan.backendVersion !== version
  )
    throw new Error(nativeT("desktop.backendUpdate.admissionMismatch"))

  const registration = profileBinding.serviceRegistration

  const bytes = await readFile(registration).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined
    throw error
  })

  if ((bytes ? createHash("sha256").update(bytes).digest("hex") : null) !== plan.registrationSha256)
    throw new Error(nativeT("desktop.backendUpdate.registrationChanged"))
  const expected = bytes
    ? Schema.decodeUnknownSync(Schema.fromJsonString(Registration))(bytes.toString("utf8"))
    : undefined

  if (expected && expected.version !== plan.previousVersion)
    throw new Error(nativeT("desktop.backendUpdate.previousMismatch"))
  // The owner selected observed-idle replacement. New input can arrive after the
  // observation; durable recovery does not undo already performed tool effects.
  const contenders: number[] = []

  const note = {
    attemptId: plan.attemptId,
    profileDigest: plan.profileDigest,
    previousVersion: plan.previousVersion,
    previousId: expected?.id ?? null,
    previousPid: expected?.pid ?? 0,
    startedAt: new Date().toISOString(),
    pendingSpawn: false,
    contenders,
  }

  await writeFile(recovery + ".tmp", JSON.stringify(note), { flush: true })
  await rename(recovery + ".tmp", recovery)

  // Journal the observed original before probing it: a crash during discovery
  // must let the supervisor clear its dead registration and restore the old CLI.
  const { Service } = await import("@opencode/client/service")

  if (expected) {
    const previous = await Service.discover({ file: registration, version: plan.previousVersion })

    if (!previous && plan.previousRunning) throw new Error(nativeT("desktop.backendUpdate.unavailable"))

    if (previous) {
      const response = await fetch(new URL("/api/session/active", expected.url), {
        headers: { authorization: `Basic ${Buffer.from(`opencode:${expected.password}`).toString("base64")}` },
        signal: AbortSignal.timeout(10_000),
      })

      if (!response.ok) throw new Error(nativeT("desktop.backendUpdate.idleUnknown"))

      const active = Schema.decodeUnknownSync(Schema.Struct({ data: Schema.Record(Schema.String, Schema.Unknown) }))(
        await response.json(),
      )

      if (Object.keys(active.data).length) throw new Error(nativeT("desktop.backendUpdate.busy"))
    }
  }

  if (expected) await Service.stop({ file: registration, expected, pty: "handoff" })

  return (event) => {
    note.pendingSpawn = event.phase === "starting"

    if (event.phase === "spawned" && event.pid !== undefined) note.contenders.push(event.pid)
    writeFileSync(recovery + ".tmp", JSON.stringify(note), { flush: true })
    renameSync(recovery + ".tmp", recovery)
  }
}
