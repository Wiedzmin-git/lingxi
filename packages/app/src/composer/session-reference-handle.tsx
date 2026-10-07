import type { JSX } from "solid-js"
import type { SessionInfo } from "@opencode/client/promise"
import type { ServerConnection } from "@/runtime/server/registry"
import { useLanguage } from "@/runtime/i18n/language"
import { startSessionReferenceDrag } from "./session-reference"

export function SessionReferenceHandle(props: {
  server: ServerConnection.Key
  session?: SessionInfo
  disabled?: boolean
  children: JSX.Element
}) {
  const language = useLanguage()
  const enabled = () => !!props.session && !props.disabled
  return (
    <span
      data-slot="session-reference-handle"
      data-session-reference-drag={enabled() ? "" : undefined}
      title={enabled() ? language.t("session.reference.drag") : undefined}
      class="flex h-5 shrink-0 items-center justify-center gap-0.5 rounded-[4px] px-0.5"
      classList={{
        "cursor-grab active:cursor-grabbing hover:bg-v2-overlay-simple-overlay-hover [-webkit-user-drag:element]": enabled(),
      }}
      draggable={enabled()}
      onPointerDown={(event) => { if (enabled()) event.stopPropagation() }}
      onMouseDown={(event) => { if (enabled() && event.button === 0) event.stopPropagation() }}
      onClick={(event) => {
        if (!enabled()) return
        event.preventDefault()
        event.stopPropagation()
      }}
      onDragStart={(event) => props.session && enabled() && startSessionReferenceDrag(event, props.server, props.session)}
    >
      <span class="pointer-events-none flex size-4 items-center justify-center">{props.children}</span>
    </span>
  )
}
