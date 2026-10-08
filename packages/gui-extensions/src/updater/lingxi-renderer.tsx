import { Button } from "@opencode/ui/button"
import { Switch } from "@opencode/ui/switch"
import { For } from "solid-js"
import { showToast } from "@opencode/ui/toast"
import { SettingsPage, TitlebarItem, type SetupContext } from "../sdk"
import type definition from "./index"

export function lingxiUpdates(ctx: SetupContext<typeof definition>) {
  const state = () => {
    const live = ctx.uses.updater()

    return live.status === "active" ? live.value.state() : undefined
  }

  const busy = () => state()?.status === "checking" || state()?.status === "downloading" || state()?.status === "installing"

  const preferences = () => {
    const live = ctx.uses.preferences()

    return live.status === "active" ? live.value.state() : undefined
  }

  const configure = (key: "automatic" | "heartbeat", checked: boolean) => {
    const live = ctx.uses.preferences()

    if (live.status !== "active") {
      showToast({ title: ctx.t("common.requestFailed") })

      return
    }

    void live.value.configure({ [key]: checked }, { signal: ctx.signal }).catch(() => {
      if (!ctx.signal.aborted) showToast({ title: ctx.t("common.requestFailed") })
    })
  }

  const progress = () => {
    const current = state()

    if (current?.status !== "downloading") return ""

    if (current.percent === 100) return ctx.t("lingxi.verifying")

    if (!current.bytesPerSecond) return ctx.t("lingxi.progress", { percent: current.percent ?? 0 })

    return ctx.t("lingxi.transfer", {
      percent: current.percent ?? 0,
      speed: (current.bytesPerSecond / 1_000_000).toFixed(1),
    })
  }

  const details = () => {
    const current = state()

    if (current?.status !== "downloading" || current.total === undefined || current.received === undefined)
      return title()

    if (current.percent === 100) return ctx.t("lingxi.verifying")

    const values = { received: (current.received / 1_000_000).toFixed(1), total: (current.total / 1_000_000).toFixed(1) }

    return current.remainingSeconds === undefined
      ? ctx.t("lingxi.bytes", values)
      : ctx.t("lingxi.remaining", { ...values, seconds: Math.ceil(current.remainingSeconds) })
  }

  const title = () => {
    const current = state()

    if (current?.status === "lingxi-bootstrap") return ctx.t("lingxi.bootstrap")

    if (current?.status === "lingxi-available") return ctx.t("lingxi.available", { version: current.version })

    if (current?.status === "lingxi-staged") return ctx.t("lingxi.staged", { version: current.version })

    if (current?.status === "downloading") return progress()

    if (current?.status === "checking") return ctx.t("action.checking")

    if (current?.status === "installing") return ctx.t("lingxi.restarting")

    if (current?.status === "up-to-date") return ctx.t("toast.latest.title")

    if (current?.status === "error") return current.message

    return ctx.t("lingxi.automatic")
  }

  const label = () => {
    if (state()?.status === "lingxi-bootstrap") return ctx.t("lingxi.reopen")

    if (state()?.status === "lingxi-available") return ctx.t("lingxi.download")

    if (state()?.status === "lingxi-staged") return ctx.t("lingxi.restart")

    if (state()?.status === "installing") return ctx.t("lingxi.restarting")

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

    if (busy()) return

    const current = state()

    if (current?.status === "lingxi-bootstrap") {
      showToast({ title: ctx.t("lingxi.reopen"), description: ctx.t("lingxi.bootstrap") })

      return
    }

    const operate = () => {
      if (current?.status === "lingxi-staged")
        return live.value.restart({ sha256: current.sha256, channel: current.channel }, { signal: ctx.signal })

      if (current?.status === "lingxi-available")
        return live.value.stage({ sha256: current.sha256, channel: current.channel }, { signal: ctx.signal })

      return live.value.check({ signal: ctx.signal })
    }

    void operate()
      .then((result) => {
        if (!ctx.signal.aborted && result?.status === "error")
          showToast({ title: ctx.t("common.requestFailed"), description: result.message })
      })
      .catch((error: Error) => {
        if (!ctx.signal.aborted)
          showToast({ title: ctx.t("common.requestFailed"), description: error.message })
      })
  }

  ctx.add(TitlebarItem, () => {
    const current = state()

    if (
      current?.status !== "lingxi-available" &&
      current?.status !== "lingxi-staged" &&
      current?.status !== "installing" &&
      current?.status !== "lingxi-bootstrap" &&
      current?.status !== "downloading"
    )
      return

    return {
      id: "update",
      label: label(),
      title: details(),
      busy: busy(),
      expanded: current.status === "downloading",
      attention: preferences()?.heartbeat && current.status === "lingxi-available" ? current.sha256 : undefined,
      run,
    }
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
          <For each={["automatic", "heartbeat"] as const}>
            {(key) => (
              <div data-component="settings-row">
                <div data-slot="settings-row-copy">
                  <div data-slot="settings-row-title">{ctx.t(`lingxi.${key}.title`)}</div>
                  <div data-slot="settings-row-description">{ctx.t(`lingxi.${key}.description`)}</div>
                </div>
                <div data-slot="settings-row-control">
                  <Switch
                    hideLabel
                    disabled={!preferences()}
                    checked={preferences()?.[key] ?? false}
                    onChange={(checked) => configure(key, checked)}
                  >
                    {ctx.t(`lingxi.${key}.title`)}
                  </Switch>
                </div>
              </div>
            )}
          </For>
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
              <div data-slot="settings-row-description">{state()?.status === "downloading" ? details() : ctx.t("lingxi.restartDescription")}</div>
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
