import { createHash, timingSafeEqual } from "node:crypto"
import { readFile } from "node:fs/promises"

export class LinkError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

export function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex")
}

export function parsePolicy(value) {
  if (!value || !Array.isArray(value.wake?.allow) || !Array.isArray(value.wake?.deny))
    throw new Error("Policy needs wake.allow and wake.deny lists")
  const patterns = [...value.wake.allow, ...value.wake.deny]
  if (patterns.some((item) => typeof item !== "string" || !/^(\*|session:\*|session:ses_[\w-]+|external:[\w-]+)$/.test(item)))
    throw new Error("Wake entries must be *, session:*, session:ses_..., or external:<sender>")
  if (!Array.isArray(value.senders)) throw new Error("Policy needs a senders list")
  const ids = new Set()
  for (const sender of value.senders) {
    if (!/^[\w-]{1,64}$/.test(sender.id) || ids.has(sender.id)) throw new Error("Invalid or duplicate sender ID")
    if (typeof sender.label !== "string" || !sender.label.trim() || sender.label.length > 120)
      throw new Error("Sender needs a short label")
    if (typeof sender.authority !== "string" || !sender.authority.trim() || sender.authority.length > 120)
      throw new Error("Sender needs an owner-defined authority label")
    if (!/^[a-f0-9]{64}$/.test(sender.tokenHash)) throw new Error("Sender needs a SHA-256 token hash")
    ids.add(sender.id)
  }
  return value
}

export async function readPolicy(file) {
  return parsePolicy(JSON.parse(await readFile(file, "utf8")))
}

export function canWake(policy, senderID) {
  const matches = (pattern) => pattern === "*" || pattern === senderID || (pattern === "session:*" && senderID.startsWith("session:"))
  return !policy.wake.deny.some(matches) && policy.wake.allow.some(matches)
}

export function authenticate(policy, id, authorization) {
  const sender = policy.senders.find((item) => item.id === id)
  const token = typeof authorization === "string" && authorization.startsWith("Bearer ") ? authorization.slice(7) : ""
  if (!sender || !token || !timingSafeEqual(Buffer.from(sender.tokenHash, "hex"), Buffer.from(tokenHash(token), "hex")))
    throw new LinkError(401, "unauthorized", "Unknown sender or invalid knock")
  return { id: `external:${sender.id}`, label: sender.label, authority: sender.authority }
}
