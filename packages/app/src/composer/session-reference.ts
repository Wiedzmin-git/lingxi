import { Option, Schema } from "effect"
import type { SessionInfo } from "@opencode/client/promise"
import type { ServerConnection } from "@/runtime/server/registry"

export const SESSION_REFERENCE_MIME = "application/x-opencode-session-reference"

const decodeReference = Schema.decodeUnknownOption(Schema.Struct({
  server: Schema.String,
  sessionID: Schema.String.check(Schema.isPattern(/^ses_[A-Za-z0-9_-]+$/)),
  title: Schema.String,
}).pipe(Schema.fromJsonString))

export function startSessionReferenceDrag(event: DragEvent, server: ServerConnection.Key, session: SessionInfo) {
  if (!event.dataTransfer) return
  event.stopPropagation()
  event.dataTransfer.effectAllowed = "copy"
  event.dataTransfer.setData(SESSION_REFERENCE_MIME, JSON.stringify({ server, sessionID: session.id, title: session.title }))
}

export function readSessionReferenceDrag(event: DragEvent, server: string) {
  const value = Option.getOrUndefined(decodeReference(event.dataTransfer?.getData(SESSION_REFERENCE_MIME)))
  // IDs are installation-local. A remote server's identical ID must never silently target this one.
  if (!value || value.server !== server) return
  return { type: "session" as const, server: value.server, sessionID: value.sessionID, title: value.title,
    content: value.title || value.sessionID, start: 0, end: 0 }
}
