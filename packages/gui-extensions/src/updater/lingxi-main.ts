import { execFile } from "node:child_process"
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

const Progress = Schema.Struct({ percent: Schema.Number })

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
      maxBuffer: 65_536,
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
        update({ ...state, percent: result.value.percent })
      }
    })
    pending = operation
      .then(({ stdout }) => {
        if (ctx.scope.signal.aborted) return state
        const offer = Schema.decodeUnknownSync(Schema.fromJsonString(Offer))(stdout)

        if (offer.status === "up-to-date") return update({ status: "up-to-date" })

        if (!offer.version || !offer.sha256 || !/^[a-f0-9]{64}$/.test(offer.sha256))
          throw new Error("Invalid update offer")

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
  })

  // The main owner checks once after startup and periodically while open; windows
  // share one check and receive the native IPC state, never credentials.
  const first = setTimeout(() => void run(), 10_000)
  const interval = setInterval(() => void run(), 30 * 60_000)
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
