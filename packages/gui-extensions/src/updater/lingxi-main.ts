import { execFile, spawn } from "node:child_process"
import path from "node:path"
import { promisify } from "node:util"
import { app } from "electron"
import { Exit, Schema } from "effect"
import { MenubarItem, type MainSetup } from "../sdk/main"
import { Updater, type UpdaterState, type UpdateSelection } from "./contract"
import type definition from "./index"

const Offer = Schema.Struct({
  status: Schema.Literals(["available", "staged", "up-to-date"]),
  channel: Schema.Literals(["dev", "stable"]),
  version: Schema.NullOr(Schema.String),
  sha256: Schema.NullOr(Schema.String),
})

const Progress = Schema.Struct({
  percent: Schema.Number,
  received: Schema.optional(Schema.Number),
  total: Schema.optional(Schema.Number),
  bytesPerSecond: Schema.optional(Schema.Number),
  remainingSeconds: Schema.optional(Schema.NullOr(Schema.Number)),
})

const setup: MainSetup<typeof definition> = (ctx) => {
  let state: UpdaterState = { status: "idle" }
  let pending: Promise<UpdaterState> | undefined
  const execute = promisify(execFile)
  const digest = process.env.LINGXI_BUNDLE_DIGEST
  const directory = path.dirname(app.getPath("exe"))

  const managed =
    ctx.build.packaged &&
    process.platform === "win32" &&
    digest &&
    path.basename(directory) === digest &&
    path.basename(path.dirname(directory)) === "bundles"

  const root = path.dirname(path.dirname(directory))
  const helper = path.join(process.resourcesPath, "lingxi-updater", "Lingxi.Launcher.exe")

  const update = (next: UpdaterState) => {
    if (ctx.scope.signal.aborted) return state
    state = next
    provider.changed()

    return state
  }

  const run = (selection?: UpdateSelection): Promise<UpdaterState> => {
    if (state.status === "installing") return Promise.reject(new Error(ctx.t("lingxi.selectionChanged")))

    if (pending && selection) return Promise.reject(new Error(ctx.t("lingxi.selectionChanged")))

    if (pending) return pending

    if (!managed) return Promise.resolve(update({ status: "error", message: ctx.t("lingxi.unmanaged") }))
    const selected = state

    if (
      selection &&
      (selected.status !== "lingxi-available" ||
        selected.sha256 !== selection.sha256 ||
        selected.channel !== selection.channel)
    )
      return Promise.reject(new Error(ctx.t("lingxi.selectionChanged")))

    const args = selection ? ["desktop-stage", root, selection.sha256, selection.channel] : ["desktop-check", root]

    update(
      selection && selected.status === "lingxi-available"
        ? { status: "downloading", version: selected.version }
        : { status: "checking" },
    )

    const operation = execute(helper, args, {
      windowsHide: true,
      signal: ctx.scope.signal,
      timeout: selection ? 16 * 60_000 : 70_000,
      // Up to sixteen minutes of one-second progress frames are retained by execFile.
      maxBuffer: 1_048_576,
    })

    let progress = ""
    operation.child.stderr?.setEncoding("utf8")
    operation.child.stderr?.on("data", (chunk: string) => {
      progress += chunk
      const lines = progress.split("\n")
      progress = lines.pop() ?? ""

      if (progress.length > 4096) progress = ""

      for (const line of lines) {
        // stderr also carries sanitized helper failures; only progress frames update the UI.
        const result = Schema.decodeUnknownExit(Schema.fromJsonString(Progress))(line)

        if (!Exit.isSuccess(result) || state.status !== "downloading") continue

        if (!Number.isInteger(result.value.percent) || result.value.percent < 0 || result.value.percent > 100) continue
        const frame = result.value

        if ([frame.received, frame.total, frame.bytesPerSecond, frame.remainingSeconds].some(
          (value) => value != null && (!Number.isFinite(value) || value < 0),
        )) continue

        if (frame.received !== undefined && frame.total !== undefined && frame.received > frame.total) continue
        update({ ...state, ...frame, remainingSeconds: frame.remainingSeconds ?? undefined })
      }
    })
    pending = operation
      .then(({ stdout }) => {
        if (ctx.scope.signal.aborted) return state
        const offer = Schema.decodeUnknownSync(Schema.fromJsonString(Offer))(stdout)

        if (offer.status === "up-to-date") return update({ status: "up-to-date" })

        if (!offer.version || !offer.sha256 || !/^[a-f0-9]{64}$/.test(offer.sha256))
          throw new Error("Invalid update offer")

        if (offer.status === "staged" && offer.sha256 === digest) return update({ status: "lingxi-bootstrap" })

        return update({
          status: offer.status === "available" ? "lingxi-available" : "lingxi-staged",
          version: offer.version,
          sha256: offer.sha256,
          channel: offer.channel,
        })
      })
      .catch(() => update({ status: "error", message: ctx.t("lingxi.failed") }))
      .finally(() => {
        pending = undefined
      })

    return pending
  }

  const provider = ctx.provide(Updater, {
    state: () => state,
    check: () => run(),
    install: async () => {
      throw new Error(ctx.t("lingxi.selectionChanged"))
    },
    stage: (selection) => run(selection),
    restart: async (selection) => {
      const staged = state

      if (!managed || pending || staged.status !== "lingxi-staged" || staged.sha256 !== selection.sha256 || staged.channel !== selection.channel)
        throw new Error(ctx.t("lingxi.selectionChanged"))
      update({ status: "installing", version: staged.version })

      // Validate and arm the exact successor before disposing any main extension.
      const child = spawn(helper, ["desktop-restart", root, selection.sha256, selection.channel], {
        windowsHide: true,
        detached: true,
        stdio: ["ignore", "pipe", "ignore"],
      })

      const cancel = () => child.kill()
      ctx.scope.signal.addEventListener("abort", cancel, { once: true })

      try {
        await new Promise<void>((resolve, reject) => {
              const deadline = setTimeout(() => reject(new Error(ctx.t("lingxi.restartFailed"))), 20_000)
              let text = ""

              child.once("error", reject)
              child.once("exit", () => reject(new Error(ctx.t("lingxi.restartFailed"))))
              child.stdout.setEncoding("utf8")
              child.stdout.on("data", (chunk: string) => {
                text += chunk

                if (text.trim() !== "ready") return
                clearTimeout(deadline)
                resolve()
              })
              child.once("exit", () => clearTimeout(deadline))
              child.once("error", () => clearTimeout(deadline))
        })

        if (ctx.scope.signal.aborted || child.exitCode !== null) throw new Error(ctx.t("lingxi.restartFailed"))

        await ctx.lifecycle.restart(() => {
          if (child.exitCode !== null) throw new Error(ctx.t("lingxi.restartFailed"))
          ctx.scope.signal.removeEventListener("abort", cancel)
          child.stdout.destroy()
          child.unref()
          // The lifecycle has disposed other extensions and synchronously flushed
          // storage immediately before this handoff. Avoid a second cancellable quit.
          app.exit(0)
        }, { keep: ctx.scope })
      } catch {
        cancel()
        update(staged)
        throw new Error(ctx.t("lingxi.restartFailed"))
      } finally {
        ctx.scope.signal.removeEventListener("abort", cancel)
      }
    },
  })

  // The main owner checks once after startup and periodically while open; windows
  // share one check and receive the native IPC state, never credentials.
  const checkAutomatically = () => {
    if (ctx.stores.preferences.value.automatic && state.status !== "lingxi-staged" && state.status !== "installing") void run()
  }

  const first = setTimeout(checkAutomatically, 10_000)
  const interval = setInterval(checkAutomatically, 30 * 60_000)
  ctx.scope.addFinalizer(() => {
    clearTimeout(first)
    clearInterval(interval)
  })
  ctx.add(MenubarItem, {
    menu: "app",
    id: "check",
    label: ctx.t("menu.check"),
    after: "about",
    run: () => {
      void run()
    },
  })
}

export default setup
