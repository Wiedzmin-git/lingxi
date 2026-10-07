export function blankBranch(sessionID, title = sessionID) {
  return { sessionID, title, active: false, phase: "detail-unknown", inboxIDs: [], permissionIDs: [], tools: [] }
}

export function fromInspection(value, previous) {
  const tools = value.active ? value.step?.tools.filter((tool) => ["running", "streaming"].includes(tool.status)) ?? [] : []
  // A current projection replaces, rather than preserves, a cached live phase.
  // Projections do not say whether the model is currently writing text/reasoning.
  const phase = value.pendingPermissions.length ? "waiting-permission"
    : value.active ? tools.length ? "running-tool" : "running-detail-unknown"
      : value.session.outcome ?? "idle"
  return {
    ...blankBranch(value.session.id), ...previous,
    title: value.session.title ?? value.session.id,
    active: !!value.active, phase, tools,
    inboxIDs: value.inbox.map((item) => item.id),
    permissionIDs: value.pendingPermissions.map((item) => item.id),
    stepID: value.step?.id,
    lastProjectedAt: value.session.time.updated,
    snapshotAt: Date.now(),
  }
}

export function applyEvent(previous, event) {
  if (event.type === "session.deleted") return undefined
  const data = event.data
  const state = { ...previous, tools: previous.tools.map((tool) => ({ ...tool })), lastActivityAt: event.created, lastObservedEventAt: Date.now(), lastEvent: event.type }
  if (["session.created", "session.renamed"].includes(event.type) && data.title) state.title = data.title
  if (event.type === "session.execution.started") { state.active = true; state.phase = "starting-detail-unknown" }
  if (event.type === "session.step.started") { state.stepID = data.assistantMessageID; state.phase = "waiting-model"; state.tools = [] }
  if (event.type === "session.reasoning.delta") state.phase = "reasoning"
  if (event.type === "session.text.delta") state.phase = "generating-text"
  if (event.type === "session.step.streamed") state.phase = state.tools.length ? "running-tool" : "step-settling"
  if (event.type === "session.tool.input.started") {
    state.phase = "preparing-tool"
    state.tools = [...state.tools.filter((tool) => tool.id !== data.id), { id: data.id, name: data.name, status: "streaming" }]
  }
  if (event.type === "session.tool.called") {
    state.phase = "running-tool"
    const tool = state.tools.find((item) => item.id === data.id)
    if (tool) tool.status = "running"
    else state.tools.push({ id: data.id, name: "name-not-observed", status: "running" })
  }
  if (event.type === "session.tool.progress") {
    const tool = state.tools.find((item) => item.id === data.id)
    if (tool && typeof data.metadata?.status === "string") tool.progress = data.metadata.status.slice(0, 200)
  }
  if (["session.tool.success", "session.tool.failed"].includes(event.type)) {
    state.tools = state.tools.filter((tool) => tool.id !== data.id)
    if (!state.tools.length) state.phase = "step-settling"
  }
  if (event.type === "session.inbox.enqueued") state.inboxIDs = [...new Set([...state.inboxIDs, data.inboxID])]
  if (["session.inbox.delivered", "session.inbox.cancelled"].includes(event.type)) state.inboxIDs = state.inboxIDs.filter((id) => id !== data.inboxID)
  if (event.type === "permission.asked") { state.phase = "waiting-permission"; state.permissionIDs = [...new Set([...state.permissionIDs, data.id])] }
  if (event.type === "permission.replied") {
    state.permissionIDs = state.permissionIDs.filter((id) => id !== data.requestID)
    if (!state.permissionIDs.length) state.phase = state.active ? "running-detail-unknown" : "idle"
  }
  if (["session.execution.succeeded", "session.execution.failed", "session.execution.interrupted"].includes(event.type)) {
    state.active = false
    state.phase = event.type.split(".").at(-1)
    state.tools = []
  }
  return state
}
