import type { PermissionApi } from "@opencode/client/effect/api"
import type { Agent } from "@opencode/schema/agent"
import type { Permission } from "@opencode/schema/permission"
import type { Session } from "@opencode/schema/session"
import type { Hooks } from "./registration.js"
import type { Tool } from "@opencode/schema/tool"
import type { Effect } from "effect"

export interface PermissionEvaluation {
  readonly sessionID: Session.ID
  readonly agent?: Agent.ID
  readonly action: string
  readonly resources: ReadonlyArray<string>
  readonly metadata?: Record<string, unknown>
  readonly source?: Permission.Source
  effect: Permission.Effect
  message?: string
}

export interface PermissionHooks {
  readonly evaluate: PermissionEvaluation
}

export type PermissionDomain = Pick<PermissionApi<unknown>, "list" | "get" | "reply"> & {
  readonly hook: Hooks<PermissionHooks>
  /** Plugin-local capability, not a new server HTTP permission API. */
  readonly authorizeRead: (input: { readonly path: string; readonly context: Pick<Tool.Context, "sessionID" | "agent" | "messageID" | "id"> }) => Effect.Effect<string, unknown>
}
