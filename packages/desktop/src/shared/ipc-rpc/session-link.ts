import { Rpc, RpcGroup } from "effect/unstable/rpc"
import { SessionLinkRequest, SessionLinkResult } from "@opencode/app/session-link"

export const SessionLinkRpcs = RpcGroup.make(Rpc.make("SessionLinkManage", {
  payload: { request: SessionLinkRequest }, success: SessionLinkResult,
}))
