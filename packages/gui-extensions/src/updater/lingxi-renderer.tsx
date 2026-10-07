import { Button } from "@opencode/ui/button"
import { showToast } from "@opencode/ui/toast"
import { SettingsPage, TitlebarItem, type SetupContext } from "../sdk"
import type definition from "./index"

export function lingxiUpdates(ctx: SetupContext<typeof definition>) {
  const state = () => {
    const live = ctx.uses.updater()

    return live.status === "active" ? live.value.state() : undefined
  }

  const busy = () => state()?.status === "checking" || state()?.status === "downloading"

  const title = () => {
    const current = state()

    if (current?.status === "lingxi-available") return ctx.t("lingxi.available", { version: current.version })

    if (current?.status === "lingxi-staged") return ctx.t("lingxi.staged", { version: current.version })

    if (current?.status === "downloading")
      return current.percent === 100
        ? ctx.t("lingxi.verifying")
        : ctx.t("lingxi.progress", { percent: current.percent ?? 0 })

    if (current?.status === "checking") return ctx.t("action.checking")

    if (current?.status === "up-to-date") return ctx.t("toast.latest.title")

    if (current?.status === "error") return current.message

    return ctx.t("lingxi.automatic")
  }

  const label = () => {
    if (state()?.status === "lingxi-available") return ctx.t("lingxi.download")

    if (state()?.status === "lingxi-staged") return ctx.t("lingxi.ready")

    if (state()?.status === "downloading") return title()

    if (state()?.status === "checking") return ctx.t("action.checking")

    return ctx.t("action.checkNow")
  }

  const run = () => {
    const live = ctx.uses.updater()

    if (live.status !== "active") {
      showToast({ title: ctx.t("common.requestFailed") })

      return
    }

    if (state()?.status === "lingxi-staged") {
      showToast({ title: ctx.t("lingxi.ready"), description: ctx.t("lingxi.nextLaunch") })

      return
    }

    if (busy()) return

    const current = state()

    const operation =
      current?.status === "lingxi-available"
        ? live.value.stage({ sha256: current.sha256, channel: current.channel }, { signal: ctx.signal })
        : live.value.check({ signal: ctx.signal })

    void operation
      .then((result) => {
        if (!ctx.signal.aborted && result.status === "error")
          showToast({ title: ctx.t("common.requestFailed"), description: result.message })
      })
      .catch(() => {
        if (!ctx.signal.aborted)
          showToast({ title: ctx.t("common.requestFailed"), description: ctx.t("lingxi.selectionChanged") })
      })
  }

  ctx.add(TitlebarItem, () => {
    const current = state()

    if (
      current?.status !== "lingxi-available" &&
      current?.status !== "lingxi-staged" &&
      current?.status !== "downloading"
    )
      return

    return { id: "update", label: label(), title: title(), busy: busy(), run }
  })
  ctx.add(SettingsPage, {
    id: "updates",
    page: "general",
    available: "desktop",
    get title() {
      return ctx.t("section.title")
    },
    render: () => (
      <div class="settings-section">
        <h3 class="settings-section-title">{ctx.t("section.title")}</h3>
        <div data-component="settings-list">
          <div data-component="settings-row">
            <div data-slot="settings-row-copy">
              <div data-slot="settings-row-title">{ctx.t("lingxi.version")}</div>
            </div>
            <div data-slot="settings-row-control" class="text-v2-text-text-muted tabular-nums select-text">
              {ctx.build.version}
            </div>
          </div>
          <div data-component="settings-row">
            <div data-slot="settings-row-copy">
              <div data-slot="settings-row-title">{title()}</div>
              <div data-slot="settings-row-description">{ctx.t("lingxi.nextLaunch")}</div>
            </div>
            <div data-slot="settings-row-control">
              <Button size="normal" variant="neutral" disabled={busy()} onClick={run}>
                {label()}
              </Button>
            </div>
          </div>
        </div>
      </div>
    ),
  })
}
