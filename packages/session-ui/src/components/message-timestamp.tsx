import { createMemo } from "solid-js"
import { useI18n } from "@opencode/ui/context/i18n"

export function MessageTimestamp(props: { created: number }) {
  const i18n = useI18n()
  const format = createMemo(() => new Intl.DateTimeFormat(i18n.locale(), { dateStyle: "short", timeStyle: "medium" }))
  const date = createMemo(() => new Date(props.created))

  return (
    <time
      dateTime={date().toISOString()}
      aria-label={i18n.t("ui.message.timestamp")}
      title={date().toLocaleString(i18n.locale(), { timeZoneName: "short" })}
      class="block mb-1 select-none text-12-regular text-v2-text-text-faint tabular-nums"
      style={{ "line-height": "var(--line-height-compact)" }}
    >
      {format().format(date())}
    </time>
  )
}
