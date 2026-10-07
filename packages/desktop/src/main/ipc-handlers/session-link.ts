import { Effect } from "effect"
import { SessionLinkRpcs } from "../../shared/ipc-rpc/session-link"
import { manageSessionLink } from "../service/session-link"

export const sessionLinkHandlers = SessionLinkRpcs.toLayer(SessionLinkRpcs.of({
  SessionLinkManage: ({ request }) => Effect.promise(() => manageSessionLink(request)),
}))
