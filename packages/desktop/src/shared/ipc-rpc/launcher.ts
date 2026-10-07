import { Rpc, RpcGroup } from "effect/unstable/rpc"

export const LauncherRpcs = RpcGroup.make(Rpc.make("AppReportStartupReady"))
