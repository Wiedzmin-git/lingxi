import { createHash, randomUUID } from "node:crypto"
import { canWake, LinkError } from "./policy.mjs"
import { consultationHeader } from "./consultation-policy.mjs"

export const messageSchema = {
  type: "object",
  properties: {
    targetSessionID: { type: "string", pattern: "^ses_[A-Za-z0-9_-]+$" },
    text: { type: "string", minLength: 1, maxLength: 48000 },
    mode: { type: "string", enum: ["wake", "queue", "steer"] },
    messageID: { type: "string", minLength: 1, maxLength: 128 },
  },
  required: ["targetSessionID", "text", "mode"],
  additionalProperties: false,
}

export function parseMessage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new LinkError(400, "invalid_input", "Expected a message object")
  if (Object.keys(value).some((key) => !Object.hasOwn(messageSchema.properties, key)))
    throw new LinkError(400, "invalid_input", "Unexpected message field; sender identity is not a message field")
  if (typeof value.targetSessionID !== "string" || !/^ses_[A-Za-z0-9_-]+$/.test(value.targetSessionID))
    throw new LinkError(400, "invalid_input", "Invalid target Session ID")
  if (typeof value.text !== "string" || !value.text.trim() || value.text.length > 48000)
    throw new LinkError(400, "invalid_input", "Message text must contain 1–48000 characters")
  if (!["wake", "queue", "steer"].includes(value.mode)) throw new LinkError(400, "invalid_input", "Unknown delivery mode")
  if (value.messageID !== undefined && (typeof value.messageID !== "string" || !value.messageID || value.messageID.length > 128))
    throw new LinkError(400, "invalid_input", "Invalid message ID")
  return { ...value, messageID: value.messageID ?? randomUUID() }
}

export async function deliver(api, policy, sender, message) {
  if (message.mode !== "queue" && !canWake(policy, sender.id))
    throw new LinkError(403, "wake_denied", "This sender may queue messages, but may not wake or steer a branch")
  const target = await api.get({ sessionID: message.targetSessionID })
  if (target.revert) throw new LinkError(409, "revert_staged", "Resolve the recipient's staged revert before sending")
  const origin = {
    senderID: sender.id,
    label: sender.label,
    authority: sender.authority,
    ...(sender.sessionID ? { replyToSessionID: sender.sessionID, agent: sender.agent } : {}),
  }
  const id = `msg_${createHash("sha256").update(JSON.stringify([sender.id, message.messageID])).digest("hex").slice(0, 32)}`
  const input = {
    sessionID: message.targetSessionID,
    id,
    description: `From ${sender.label} · ${message.mode}`,
    text: `${sender.id.startsWith("external:") ? `${consultationHeader}\n` : ""}Message source: ${JSON.stringify(origin)}\nDelivery: ${message.mode}\n\n${message.text}`,
    metadata: { source: "session-link", sessionLink: { ...origin, mode: message.mode, messageID: message.messageID } },
    delivery: message.mode === "steer" ? "steer" : "queue",
    resume: false,
  }
  // Admission is durable; native first-admission-wins semantics also govern retries.
  // Read back the admitted mode before advising execution, so a retry cannot turn
  // a previously parked queue item into a wake request by changing its mode.
  const admitted = await api.synthetic(input)
  const mode = admitted.payload.metadata.sessionLink.mode
  if (mode !== "queue") {
    if (!canWake(policy, sender.id)) throw new LinkError(403, "wake_denied", "Wake permission has been removed")
    await api.synthetic({ ...input, resume: true })
  }
  return {
    status: "accepted",
    targetSessionID: admitted.sessionID,
    inboxID: admitted.id,
    messageID: admitted.payload.metadata.sessionLink.messageID,
    mode,
    delivery: admitted.delivery,
    wakeAdvised: mode !== "queue",
  }
}
