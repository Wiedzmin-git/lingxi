import { createHash } from "node:crypto"
import { LinkError } from "./policy.mjs"

export const R2_MAIL_PATH = "/session-link/r2/mail"
export const R2_LIMITS = Object.freeze({ fileBytes: 8 * 1024 * 1024, bundleBytes: 32 * 1024 * 1024, files: 16, storageBytes: 512 * 1024 * 1024 })

const sessionPattern = /^ses_[A-Za-z0-9_-]+$/
const installationPattern = /^ins_[a-f0-9-]{36}$/
const capabilityPattern = /^cap_[a-f0-9-]{36}$/
const fail = (message) => { throw new LinkError(400, "invalid_r2", message) }

function object(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !fields.includes(key)))
    fail(`Invalid ${label} fields`)
  return value
}

function string(value, max, label, pattern) {
  if (typeof value !== "string" || !value || value.length > max || (pattern && !pattern.test(value))) fail(`Invalid ${label}`)
  return value
}

/** This parses routing only. The transport must additionally enforce its owner-configured network boundary. */
export function parseEndpoint(value) {
  string(value, 2048, "mail endpoint")
  const url = (() => { try { return new URL(value) } catch { fail("Invalid mail endpoint") } })()
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== R2_MAIL_PATH)
    fail("An endpoint must be a plain HTTP(S) R2 mailbox URL, not an OpenCode API or arbitrary resource")
  return url.href
}

/** A private bearer invitation. Never place it in model content, public manifests, receipts or logs. */
export function parseInvitation(value) {
  const invitation = object(value, ["protocolVersion", "endpoint", "installationID", "sessionID", "capabilityID", "secret"], "invitation")
  if (invitation.protocolVersion !== 2) fail("Unsupported invitation version")
  return {
    protocolVersion: 2,
    endpoint: parseEndpoint(invitation.endpoint),
    installationID: string(invitation.installationID, 64, "installation ID", installationPattern),
    sessionID: string(invitation.sessionID, 128, "recipient Session ID", sessionPattern),
    capabilityID: string(invitation.capabilityID, 64, "delivery capability", capabilityPattern),
    secret: string(invitation.secret, 43, "private delivery secret", /^[A-Za-z0-9_-]{43}$/),
  }
}

export function encodeInvitation(value) {
  return `opencode-branch:v2:${Buffer.from(JSON.stringify(parseInvitation(value))).toString("base64url")}`
}

export function decodeInvitation(value) {
  string(value, 8192, "branch address")
  const prefix = "opencode-branch:v2:"
  if (!value.startsWith(prefix) || !/^[A-Za-z0-9_-]+$/.test(value.slice(prefix.length))) fail("Invalid branch address format")
  const encoded = value.slice(prefix.length)
  const bytes = Buffer.from(encoded, "base64url")
  if (bytes.toString("base64url") !== encoded) fail("Invalid branch address encoding")
  const parsed = (() => { try { return JSON.parse(bytes.toString("utf8")) } catch { fail("Invalid branch address JSON") } })()
  return parseInvitation(parsed)
}

function identity(value) {
  object(value, ["installationID", "sessionID"], "branch identity")
  return { installationID: string(value.installationID, 64, "installation ID", installationPattern), sessionID: string(value.sessionID, 128, "Session ID", sessionPattern) }
}

export function parseEnvelope(value) {
  object(value, ["protocolVersion", "messageID", "target", "source", "replyTo", "inReplyTo", "sentAt", "mode", "text", "attachments"], "envelope")
  if (value.protocolVersion !== 2) fail("Unsupported mail version")
  const target = identity(value.target)
  const source = object(value.source, ["installationID", "sessionID", "computer", "user", "title", "agent"], "source")
  const sourceIdentity = identity({ installationID: source.installationID, sessionID: source.sessionID })
  const replyTo = parseInvitation(value.replyTo)
  if (replyTo.installationID !== sourceIdentity.installationID || replyTo.sessionID !== sourceIdentity.sessionID)
    fail("The mandatory reverse invitation must address the sending branch")
  if (!["wake", "queue", "steer"].includes(value.mode)) fail("Invalid mail mode")
  if (typeof value.text !== "string" || !value.text.trim() || value.text.length > 48000) fail("Mail requires 1–48000 text characters")
  if (!Number.isSafeInteger(value.sentAt) || value.sentAt < 0) fail("Invalid send timestamp")
  if (!Array.isArray(value.attachments) || value.attachments.length > R2_LIMITS.files) fail("Invalid attachment count")
  let total = 0
  const attachments = value.attachments.map((file) => {
    object(file, ["name", "mime", "size", "sha256", "base64"], "attachment")
    string(file.name, 255, "attachment display name")
    string(file.mime, 255, "attachment MIME type")
    string(file.sha256, 64, "attachment hash", /^[a-f0-9]{64}$/)
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > R2_LIMITS.fileBytes) fail("Attachment size exceeds the file limit")
    if (typeof file.base64 !== "string" || file.base64.length > 4 * Math.ceil(R2_LIMITS.fileBytes / 3)) fail("Attachment encoding exceeds the file limit")
    const bytes = Buffer.from(file.base64, "base64")
    if (bytes.length !== file.size || bytes.toString("base64") !== file.base64 || createHash("sha256").update(bytes).digest("hex") !== file.sha256)
      fail("Attachment byte count, encoding or SHA-256 mismatch")
    total += bytes.length
    if (total > R2_LIMITS.bundleBytes) fail("Attachment bundle exceeds the package limit")
    return { name: file.name, mime: file.mime, size: file.size, sha256: file.sha256, base64: file.base64 }
  })
  const inReplyTo = value.inReplyTo === undefined ? undefined : object(value.inReplyTo, ["installationID", "sessionID", "messageID"], "reply relation")
  return {
    protocolVersion: 2,
    messageID: string(value.messageID, 128, "logical message ID"),
    target,
    source: { ...sourceIdentity, computer: string(source.computer, 255, "computer label"), user: string(source.user, 255, "user label"),
      title: string(source.title, 512, "branch title"), agent: string(source.agent, 128, "source agent") },
    replyTo,
    ...(inReplyTo ? { inReplyTo: { ...identity({ installationID: inReplyTo.installationID, sessionID: inReplyTo.sessionID }), messageID: string(inReplyTo.messageID, 128, "reply message ID") } } : {}),
    sentAt: value.sentAt,
    mode: value.mode,
    text: value.text,
    attachments,
  }
}

/** This fixed tuple scopes deduplication across peers AND recipients, never across titles. */
export function envelopeIdentity(value) {
  return createHash("sha256").update(JSON.stringify([value.source.installationID, value.source.sessionID, value.messageID, value.target.installationID, value.target.sessionID])).digest("hex")
}

export function envelopeBytes(value) {
  return Buffer.from(JSON.stringify(parseEnvelope(value)))
}

export function envelopeHash(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}
