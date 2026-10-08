// Keep the durable marker readable by older builds and existing stored histories.
export const RESTART_NOTICE =
  "The server restarted while you were working. Continue from where you left off without repeating completed work."

// Only this application-authored instruction is elevated; command text and
// tool output remain ordinary result data, even when they carry notice metadata.
export const RESTART_INSTRUCTION =
  "The server restarted while you were working. Continue the existing task from its saved state. " +
  "An interrupted tool may have already performed some or all of its actions. Check the available results and current state before deciding whether to resume or repeat it. " +
  "Do not repeat completed work. This is a system recovery notice, not a new user request."
