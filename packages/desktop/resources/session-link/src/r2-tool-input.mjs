import { createHash } from "node:crypto"
import { open } from "node:fs/promises"
import path from "node:path"
import { messageSchema, parseMessage } from "./delivery.mjs"
import { LinkError } from "./policy.mjs"
import { R2_LIMITS } from "./r2-wire.mjs"

export const sendSchema = {
  ...messageSchema,
  properties: { ...messageSchema.properties,
    addressRef: { type: "string", pattern: "^addr_[a-f0-9-]{36}$" },
    inReplyTo: { type: "object", properties: { installationID: { type: "string", pattern: "^ins_[a-f0-9-]{36}$" },
      sessionID: messageSchema.properties.targetSessionID, messageID: messageSchema.properties.messageID },
      required: ["installationID", "sessionID", "messageID"], additionalProperties: false },
    attachments: { type: "array", maxItems: R2_LIMITS.files, items: { type: "object", properties: {
      path: { type: "string", minLength: 1, maxLength: 4096 }, name: { type: "string", minLength: 1, maxLength: 255 },
      mime: { type: "string", minLength: 1, maxLength: 255 } }, required: ["path"], additionalProperties: false } },
  },
  required: ["text"],
  oneOf: [{ required: ["targetSessionID"], not: { required: ["addressRef"] } }, { required: ["addressRef"], not: { required: ["targetSessionID"] } }],
}

export function parseSend(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !Object.hasOwn(sendSchema.properties, key)))
    throw new LinkError(400, "invalid_input", "Invalid branch message fields")
  if ((value.addressRef === undefined) === (value.targetSessionID === undefined))
    throw new LinkError(400, "invalid_addressing", "Choose exactly one local Session ID or remote addressRef")
  if (value.targetSessionID !== undefined) {
    // Legacy local addressing remains exactly R1, never interpreted as a remote invitation.
    if (value.inReplyTo !== undefined || value.attachments !== undefined) throw new LinkError(400, "remote_fields_required", "R2 reply relations and attachments require addressRef")
    return parseMessage(value)
  }
  if (typeof value.addressRef !== "string" || !/^addr_[a-f0-9-]{36}$/.test(value.addressRef)) throw new LinkError(400, "invalid_contact", "Invalid local contact reference")
  const validated = parseMessage({ targetSessionID: "ses_validation", text: value.text, mode: value.mode, ...(value.messageID !== undefined ? { messageID: value.messageID } : {}) })
  const relation = value.inReplyTo
  if (relation !== undefined && (!relation || typeof relation !== "object" || Array.isArray(relation) || Object.keys(relation).some((key) => !["installationID", "sessionID", "messageID"].includes(key)) ||
    !/^ins_[a-f0-9-]{36}$/.test(relation.installationID) || !/^ses_[A-Za-z0-9_-]+$/.test(relation.sessionID) || typeof relation.messageID !== "string" || !relation.messageID || relation.messageID.length > 128))
    throw new LinkError(400, "invalid_reply_relation", "Invalid exact reply identity")
  if (value.attachments !== undefined && (!Array.isArray(value.attachments) || value.attachments.length > R2_LIMITS.files)) throw new LinkError(400, "invalid_attachments", "Invalid attachment count")
  const attachments = (value.attachments ?? []).map((file) => {
    if (!file || typeof file !== "object" || Array.isArray(file) || Object.keys(file).some((key) => !["path", "name", "mime"].includes(key)) ||
      typeof file.path !== "string" || !file.path || file.path.length > 4096 || file.path.includes("\0") ||
      [file.name, file.mime].some((item) => item !== undefined && (typeof item !== "string" || !item || item.length > 255)))
      throw new LinkError(400, "invalid_attachments", "Invalid attachment path or display metadata")
    return { path: file.path, ...(file.name ? { name: file.name } : {}), ...(file.mime ? { mime: file.mime } : {}) }
  })
  return { addressRef: value.addressRef, text: value.text, mode: validated.mode, messageID: value.messageID,
    ...(relation ? { inReplyTo: { installationID: relation.installationID, sessionID: relation.sessionID, messageID: relation.messageID } } : {}), attachments }
}

export async function snapshotAttachments(files, permission, context) {
  if (files.length && !permission?.authorizeRead) throw new LinkError(503, "read_permission_adapter_missing", "This service needs the R2 native read-permission adapter before sending files")
  let total = 0
  const result = []
  for (const file of files) {
    // Authorization precedes opening. The native FileAccess leaf owns read and
    // external_directory rules, with the actual tool invocation as its source.
    const authorized = await permission.authorizeRead({ path: file.path, context: {
      sessionID: context.sessionID, agent: context.agent, messageID: context.messageID, id: context.id,
    } }, { signal: context.signal })
    context.signal?.throwIfAborted()
    const handle = await open(authorized, "r")
    try {
      const stats = await handle.stat()
      if (!stats.isFile()) throw new LinkError(400, "attachment_not_file", "An attachment must be a regular file, not a directory or device")
      if (stats.size > R2_LIMITS.fileBytes) throw new LinkError(413, "attachment_too_large", "Attachment exceeds the file limit")
      // Bounded reading also catches a file growing after stat; never read an
      // unbounded stream into memory merely because its initial size was small.
      const bytes = Buffer.alloc(Math.min(stats.size + 1, R2_LIMITS.fileBytes + 1))
      let length = 0
      while (length < bytes.length) {
        context.signal?.throwIfAborted()
        const read = await handle.read(bytes, length, bytes.length - length, null)
        if (!read.bytesRead) break
        length += read.bytesRead
      }
      if (length !== stats.size) throw new LinkError(409, "attachment_changed", "Attachment changed while snapshotting; retry with a stable file")
      total += length
      if (total > R2_LIMITS.bundleBytes) throw new LinkError(413, "attachments_too_large", "Attachments exceed the bundle limit")
      const content = bytes.subarray(0, length)
      result.push({ name: file.name ?? path.basename(authorized), mime: file.mime ?? "application/octet-stream", size: length,
        sha256: createHash("sha256").update(content).digest("hex"), base64: content.toString("base64") })
    } finally { await handle.close() }
  }
  return result
}
