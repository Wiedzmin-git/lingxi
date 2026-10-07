import { createEffect, on, onCleanup, Show, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { GenerationSpeed, type GenerationSpeedReading } from "./generation-speed"

export function GenerationSpeedIndicator(props: {
  sessionID: Accessor<string | undefined>
  active: Accessor<boolean>
}) {
  const language = useLanguage()
  const sdk = useServerSDK()
  const meter = new GenerationSpeed()
  const [state, setState] = createStore<{ reading?: GenerationSpeedReading }>({})
  let timer: ReturnType<typeof setInterval> | undefined
  const render = () => {
    const reading = meter.reading()
    setState("reading", reading)
    if (reading?.kind !== "live" && timer) {
      clearInterval(timer)
      timer = undefined
    }
  }
  createEffect(
    on(
      () => [props.sessionID(), props.active(), sdk.connection.status(), sdk.connection.attempt()] as const,
      () => {
        meter.reset()
        render()
      },
    ),
  )
  onCleanup(
    sdk.event.listen((event) => {
      if (!props.active() || !("sessionID" in event.data) || event.data.sessionID !== props.sessionID()) return
      meter.observe(event)
      if (event.type === "session.text.delta" || event.type === "session.reasoning.delta") {
        if (!timer) {
          render()
          if (state.reading?.kind === "live") timer = setInterval(render, 250)
        }
        return
      }
      render()
    }),
  )
  onCleanup(() => {
    if (timer) clearInterval(timer)
  })
  const rate = () => state.reading?.rate?.toLocaleString(language.locale(), { maximumFractionDigits: 1 })

  return (
    <Show when={state.reading}>
      {(reading) => (
        <div
          class="shrink-0 px-5 py-1 text-12-regular text-v2-text-text-faint tabular-nums select-none"
          style={{ "line-height": "var(--line-height-compact)" }}
        >
          <output
            aria-label={language.t("session.speed.label")}
            aria-live="off"
            title={language.t(reading().kind === "live" ? "session.speed.liveTooltip" : "session.speed.averageTooltip")}
          >
            {rate() === undefined
              ? language.t("session.speed.warming")
              : language.t(reading().kind === "live" ? "session.speed.live" : "session.speed.average", {
                  rate: rate()!,
                })}
          </output>
        </div>
      )}
    </Show>
  )
}
