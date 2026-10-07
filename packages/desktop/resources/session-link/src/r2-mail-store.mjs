import { createHash, randomUUID } from "node:crypto"
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises"
import path from "node:path"
import { envelopeBytes, envelopeHash, envelopeIdentity, parseEnvelope, parseInvitation, R2_LIMITS } from "./r2-wire.mjs"
import { LinkError } from "./policy.mjs"
import { openR2Database } from "./r2-database.mjs"

export async function openMailStore(root) {
  const store = await openR2Database(root)
  const db = store.database
  const get = (kind, key) => {
    const row = db.prepare("SELECT * FROM mail WHERE kind=? AND key=?").get(kind, key)
    if (!row) return
    const bytes = Buffer.from(row.envelope)
    const envelope = parseEnvelope(JSON.parse(bytes.toString("utf8")))
    if (envelopeIdentity(envelope) !== key || envelopeHash(bytes) !== row.hash) throw new Error("R2 immutable mail snapshot is corrupt")
    return { key, envelope, hash: row.hash, ...(row.address ? { address: parseInvitation(JSON.parse(row.address)) } : {}), status: JSON.parse(row.state) }
  }
  const persist = (kind, value, address, sendIntent, addressRef) => store.transaction(() => {
    const bytes = envelopeBytes(value)
    const envelope = JSON.parse(bytes.toString("utf8"))
    const key = envelopeIdentity(envelope)
    const hash = envelopeHash(bytes)
    const previous = get(kind, key)
    if (previous) {
      if (previous.hash !== hash || (kind === "outbox" && JSON.stringify(previous.address) !== JSON.stringify(address)))
        throw new LinkError(409, "envelope_conflict", "The same logical mail identity already has different immutable content")
      return previous
    }
    const { replyTo, attachments, ...summary } = envelope
    const metadata = JSON.stringify({ ...summary, attachments: attachments.map(({ base64, ...file }) => file) })
    const required = bytes.length + Buffer.byteLength(metadata) + envelope.attachments.reduce((sum, file) => sum + file.size, 0) + 16384
    const retained = db.prepare("SELECT COALESCE(SUM(length(envelope)+COALESCE(length(address),0)+length(state)+length(CAST(summary AS BLOB))),0) AS bytes FROM mail").get().bytes +
      db.prepare("SELECT COALESCE(SUM(length(bytes)),0) AS bytes FROM attachment").get().bytes
    // The independent readable inbox copy consumes the same bytes again.
    const materialized = db.prepare("SELECT COALESCE(SUM(length(bytes)),0) AS bytes FROM attachment WHERE kind='inbox'").get().bytes
    if (retained + materialized + required * (kind === "inbox" ? 2 : 1) > R2_LIMITS.storageBytes)
      throw new LinkError(507, "mail_storage_full", "Mailbox storage quota reached; no message was silently removed")
    db.prepare("INSERT INTO mail(kind,key,envelope,hash,address,state,summary) VALUES(?,?,?,?,?,?,?)").run(kind, key, bytes, hash,
      address ? JSON.stringify(address) : null,
      JSON.stringify({ stage: kind === "outbox" ? "outgoing" : "node_saved", attempts: 0, createdAt: Date.now(),
        ...(sendIntent ? { sendIntent } : {}), ...(addressRef ? { addressRef } : {}) }),
      metadata)
    for (const [index, file] of envelope.attachments.entries()) db.prepare("INSERT INTO attachment(kind,mail_key,ordinal,bytes) VALUES(?,?,?,?)")
      .run(kind, key, index, Buffer.from(file.base64, "base64"))
    return get(kind, key)
  })
  return {
    async enqueue(value, privateAddress, sendIntent, addressRef) {
      const address = parseInvitation(privateAddress)
      const envelope = parseEnvelope(value)
      if (address.installationID !== envelope.target.installationID || address.sessionID !== envelope.target.sessionID)
        throw new LinkError(400, "recipient_mismatch", "Delivery address does not match the immutable envelope recipient")
      return persist("outbox", envelope, address, sendIntent, addressRef)
    },
    // Durable node storage is not native branch admission and is never an accepted receipt.
    async stageIncoming(value) { return persist("inbox", value) },
    async get(kind, key) { return get(kind, key) },
    async list(kind) {
      if (!["inbox", "outbox"].includes(kind)) throw new LinkError(400, "invalid_mail_kind", "Invalid mailbox kind")
      return db.prepare("SELECT key FROM mail WHERE kind=?").all(kind).map((row) => get(kind, row.key))
    },
    // Polling reads a byte-free immutable projection, not retained attachment
    // packages. Full get() still verifies the snapshot before send/materialize.
    async summaries(kind) {
      if (!["inbox", "outbox"].includes(kind)) throw new LinkError(400, "invalid_mail_kind", "Invalid mailbox kind")
      return db.prepare("SELECT key,hash,summary,state FROM mail WHERE kind=?").all(kind).map((row) => ({ key: row.key,
        hash: row.hash, envelope: JSON.parse(row.summary), status: JSON.parse(row.state) }))
    },
    async state(kind, key) {
      const row = db.prepare("SELECT state FROM mail WHERE kind=? AND key=?").get(kind, key)
      if (!row) throw new LinkError(404, "mail_missing", "Unknown retained message")
      return JSON.parse(row.state)
    },
    async materializeInbox(key) {
      const original = get("inbox", key)
      if (!original) throw new LinkError(404, "mail_missing", "Unknown retained message")
      const base = path.join(path.resolve(root), "inbox-r2", key)
      await mkdir(base, { recursive: true, mode: 0o700 })
      return await Promise.all(original.envelope.attachments.map(async (file, index) => {
        // Filenames are numeric storage IDs, never the remote display names.
        const destination = path.join(base, `${index}.attachment`)
        const stored = db.prepare("SELECT bytes FROM attachment WHERE kind='inbox' AND mail_key=? AND ordinal=?").get(key, index)
        const bytes = Buffer.from(stored.bytes)
        if (bytes.length !== file.size || createHash("sha256").update(bytes).digest("hex") !== file.sha256) throw new Error("R2 saved attachment is corrupt or incomplete")
        const existing = await readFile(destination).catch((error) => { if (error.code !== "ENOENT") throw error })
        if (!existing || !bytes.equals(existing)) await atomicWrite(destination, bytes)
        return { name: file.name, mime: file.mime, size: file.size, sha256: file.sha256, path: destination }
      }))
    },
    async update(kind, key, patch) {
      return store.transaction(() => {
        const original = db.prepare("SELECT state FROM mail WHERE kind=? AND key=?").get(kind, key)
        if (!original) throw new LinkError(404, "mail_missing", "Unknown retained message")
        const allowed = ["stage", "attempts", "lastAttemptAt", "nextAttemptAt", "retryUntil", "code", "nativeInboxID", "wakeAdvised", "observedAt", "modelAttemptID", "completedAt", "replyKey", "receivedAt", "observedIP", "capabilityID", "replyToAddressRef", "sendIntent", "progress", "progressSequence", "receiptBytes", "receiptSequence", "receiptSentSequence", "receiptNextAttemptAt"]
        if (!patch || typeof patch !== "object" || Object.keys(patch).some((field) => !allowed.includes(field))) throw new LinkError(400, "invalid_mail_state", "Invalid mail state update")
        const previous = JSON.parse(original.state)
        const status = { ...previous, ...patch }
        // Admission is irreversible. A concurrent technical receipt may prove
        // it while a transport attempt still holds a pre-admission snapshot.
        if (kind === "outbox" && previous.stage === "accepted") status.stage = "accepted"
        db.prepare("UPDATE mail SET state=? WHERE kind=? AND key=?").run(JSON.stringify(status), kind, key)
        return status
      })
    },
  }
}

async function atomicWrite(file, bytes) {
  const temporary = `${file}.${randomUUID()}.tmp`
  const handle = await open(temporary, "wx", 0o600)
  try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
  await rename(temporary, file).catch(async (error) => { await unlink(temporary).catch(() => {}); throw error })
}
