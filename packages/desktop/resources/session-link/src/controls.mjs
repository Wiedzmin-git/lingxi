import path from "node:path"
import { LinkError } from "./policy.mjs"

const mutating = new Set(["stop", "create", "rename", "move", "fork", "cancel-pending"])
export const controlSchema = {
  type: "object",
  properties: {
    action: { type: "string", enum: [...mutating] },
    targetSessionID: { type: "string", pattern: "^ses_[A-Za-z0-9_-]+$" },
    title: { type: "string", minLength: 1, maxLength: 200 },
    directory: { type: "string", minLength: 1 },
    inboxID: { type: "string", minLength: 1 },
  },
  required: ["action"],
  additionalProperties: false,
}

export function parseControl(value) {
  if (!value || typeof value !== "object" || !mutating.has(value.action)) throw new LinkError(400, "invalid_control", "Unknown control action")
  const allowed = {
    stop: ["action", "targetSessionID"],
    create: ["action", "directory", "title"],
    rename: ["action", "targetSessionID", "title"],
    move: ["action", "targetSessionID", "directory"],
    fork: ["action", "targetSessionID"],
    "cancel-pending": ["action", "targetSessionID", "inboxID"],
  }[value.action]
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new LinkError(400, "invalid_control", "Unexpected action parameter; authorization cannot be supplied by the caller")
  if (value.action !== "create" && (typeof value.targetSessionID !== "string" || !/^ses_[A-Za-z0-9_-]+$/.test(value.targetSessionID)))
    throw new LinkError(400, "invalid_control", "Control needs a recipient Session ID")
  if (["create", "rename"].includes(value.action) && (typeof value.title !== "string" || !value.title.trim() || value.title.length > 200))
    throw new LinkError(400, "invalid_control", "Control needs a short nonempty title")
  if (["create", "move"].includes(value.action) && (typeof value.directory !== "string" || !path.isAbsolute(value.directory)))
    throw new LinkError(400, "invalid_control", "Control needs an existing absolute directory")
  if (value.action === "cancel-pending" && (typeof value.inboxID !== "string" || !value.inboxID))
    throw new LinkError(400, "invalid_control", "Control needs an Inbox ID")
  return value
}

// Authorization is a host-owned port, not an input flag or text interpreted by
// the model. R1 supplies it ONLY for the isolated sandbox. Working profiles stay
// blocked until an exact owner-mandate adapter is supplied and verified.
export async function control(api, authority, action, context) {
  if (!authority) throw new LinkError(403, "mandate_required", "Control requires a direct owner mandate or a verified test profile")
  await authority(action, context)
  const target = action.targetSessionID ? `/api/session/${encodeURIComponent(action.targetSessionID)}` : undefined
  switch (action.action) {
    case "stop": {
      const result = await api.requestEnvelope("POST", `${target}/interrupt?resume=false`, undefined, context.signal)
      return { action: "stop", targetSessionID: action.targetSessionID, interrupted: result.interrupted, status: result.interrupted ? "interrupted" : "idle-no-op" }
    }
    case "create": {
      const session = await api.request("POST", "/api/session", { title: action.title, location: { directory: action.directory } }, context.signal)
      return { action: "create", status: "created", session }
    }
    case "rename":
      await api.request("PATCH", target, { title: action.title }, context.signal)
      return { action: "rename", status: "renamed", session: await api.get({ sessionID: action.targetSessionID }) }
    case "move":
      await api.request("POST", `${target}/move`, { directory: action.directory, delivery: "steer" }, context.signal)
      return { action: "move", status: "admitted", requestedDirectory: action.directory, session: await api.get({ sessionID: action.targetSessionID }) }
    case "fork":
      return { action: "fork", status: "created", session: await api.request("POST", `${target}/fork`, {}, context.signal) }
    case "cancel-pending":
      await api.request("DELETE", `${target}/inbox/${encodeURIComponent(action.inboxID)}`, undefined, context.signal)
      return { action: "cancel-pending", status: "cancelled", targetSessionID: action.targetSessionID, inboxID: action.inboxID }
  }
}

export async function inspect(api, sessionID, signal) {
  const session = await api.get({ sessionID, signal })
  const [active, inbox, permissions, history] = await Promise.all([
    api.request("GET", "/api/session/active", undefined, signal),
    api.request("GET", `/api/session/${encodeURIComponent(sessionID)}/inbox`, undefined, signal),
    api.request("GET", `/api/session/${encodeURIComponent(sessionID)}/permission`, undefined, signal),
    api.request("GET", `/api/session/${encodeURIComponent(sessionID)}/context`, undefined, signal),
  ])
  const step = history.findLast((message) => message.type === "assistant")
  return {
    session, active: active[sessionID], inbox, pendingPermissions: permissions,
    step: step ? { id: step.id, model: step.model, agent: step.agent, time: step.time, finish: step.finish, tools: step.content.filter((part) => part.type === "tool").map((tool) => ({ id: tool.id, name: tool.name, status: tool.state.status })) } : undefined,
    observedAt: Date.now(),
  }
}
