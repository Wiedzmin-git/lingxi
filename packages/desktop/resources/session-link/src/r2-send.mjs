import { hostname, userInfo } from "node:os"
import { envelopeBytes, envelopeIdentity } from "./r2-wire.mjs"
import { deliverHttp, lanEndpoint } from "./r2-http.mjs"
import { LinkError } from "./policy.mjs"

const safe = (mail) => ({ mailKey: mail.key, messageID: mail.envelope.messageID, target: mail.envelope.target,
  mode: mail.envelope.mode, status: mail.status.stage, attempts: mail.status.attempts,
  ...(mail.status.code ? { code: mail.status.code } : {}), wakeAdvised: mail.status.wakeAdvised === true,
  ...(mail.status.nextAttemptAt ? { nextAttemptAt: mail.status.nextAttemptAt } : {}) })

/** The host is the sole writer and sends only previously durable immutable bytes. */
export function createR2Sender({ api, book, store, config }) {
  const active = new Map()
  const run = (key, apply) => {
    if (active.has(key)) return active.get(key)
    const result = apply()
    active.set(key, result)
    void result.finally(() => { if (active.get(key) === result) active.delete(key) }).catch(() => {})
    return result
  }
  const retryable = (mail) => ["outgoing", "unknown"].includes(mail.status.stage) ||
    (mail.status.stage === "accepted" && mail.status.code === "wake_pending")
  const attempt = (key) => run(key, async () => {
    const mail = await store.get("outbox", key)
    if (!mail || !retryable(mail)) return mail ? safe(mail) : undefined
    const policy = config()
    if (!policy.enabled) return safe(mail)
    const now = Date.now()
    const retryUntil = mail.status.retryUntil ?? mail.status.createdAt + policy.retryHours * 3600000
    if (now > retryUntil) {
      mail.status = await store.update("outbox", key, { stage: mail.status.stage === "accepted" ? "accepted" : "retry_expired", code: "retry_expired" })
      return safe(mail)
    }
    const contact = mail.status.addressRef ? await book.resolveContact(mail.envelope.source.sessionID, mail.status.addressRef).catch(() => undefined) : undefined
    if (!contact || JSON.stringify(contact) !== JSON.stringify(mail.address)) {
      mail.status = await store.update("outbox", key, { stage: mail.status.stage === "accepted" ? "accepted" : "blocked", code: "contact_denied", nextAttemptAt: null })
      return safe(mail)
    }
    const reverse = await book.currentAddress(mail.envelope.source.sessionID).catch(() => undefined)
    if (!reverse || JSON.stringify(reverse) !== JSON.stringify(mail.envelope.replyTo) || reverse.endpoint !== lanEndpoint(policy)) {
      mail.status = await store.update("outbox", key, { stage: mail.status.stage === "accepted" ? "accepted" : "blocked", code: "reverse_address_stale", nextAttemptAt: null })
      return safe(mail)
    }
    const attempts = mail.status.attempts + 1
    // The write-ahead unknown stage survives a crash after sending but before
    // persisting its receipt. It never claims that the peer did not admit it.
    mail.status = await store.update("outbox", key, { stage: mail.status.stage === "accepted" ? "accepted" : "unknown", attempts,
      lastAttemptAt: now, retryUntil, nextAttemptAt: now + Math.min(60000, 5000 * 2 ** Math.min(attempts - 1, 4)) })
    try {
      const receipt = await deliverHttp(policy, mail.address, envelopeBytes(mail.envelope))
      if (!receipt || receipt.status !== "accepted" || receipt.mailKey !== key || receipt.envelopeHash !== mail.hash ||
        receipt.target?.installationID !== mail.envelope.target.installationID || receipt.target?.sessionID !== mail.envelope.target.sessionID ||
        receipt.nativeInboxID !== `msg_${key}` || typeof receipt.wakeAdvised !== "boolean" || receipt.mode !== mail.envelope.mode)
        throw new LinkError(502, "invalid_receipt", "Mailbox receipt does not match this immutable message")
      const code = receipt.wakeAdvised || mail.envelope.mode === "queue" ? undefined :
        ["wake_denied", "address_unavailable"].includes(receipt.code) ? receipt.code : "wake_pending"
      mail.status = await store.update("outbox", key, { stage: "accepted", nativeInboxID: receipt.nativeInboxID,
        wakeAdvised: receipt.wakeAdvised, code: code ?? null, nextAttemptAt: code === "wake_pending" ? mail.status.nextAttemptAt : null })
    } catch (error) {
      const refusal = error instanceof LinkError && ([400, 401, 403, 404, 409, 413, 415, 422, 507].includes(error.status))
      const code = error instanceof LinkError ? error.code : "network_interrupted"
      const latest = await store.get("outbox", key)
      mail.status = await store.update("outbox", key, { stage: latest.status.stage === "accepted" ? "accepted" : refusal ? "refused" : "unknown",
        code, ...(refusal ? { nextAttemptAt: null } : {}) })
    }
    return safe(mail)
  })

  const find = async (senderSessionID, input) => {
    const address = await book.resolveContact(senderSessionID, input.addressRef)
    const target = { installationID: address.installationID, sessionID: address.sessionID }
    const key = envelopeIdentity({ source: { installationID: book.installationID, sessionID: senderSessionID }, messageID: input.messageID, target })
    return { address, target, key, previous: await store.get("outbox", key) }
  }
  const intent = (senderSessionID, agent, input) => JSON.stringify({ senderSessionID, agent, ...input })
  return {
    async check(senderSessionID, agent, input) {
      // The local adapter owns validation of input; no path is read here.
      if (!config().enabled) throw new LinkError(403, "lan_disabled", "LAN communication is disabled by the owner")
      await book.currentAddress(senderSessionID)
      const value = await find(senderSessionID, input)
      if (!value.previous) return { status: "snapshot_needed" }
      if (value.previous.status.sendIntent !== intent(senderSessionID, agent, input))
        throw new LinkError(409, "envelope_conflict", "The same logical message ID belongs to a different send request")
      return safe(value.previous)
    },
    async send(senderSessionID, agent, input, attachments) {
      if (!config().enabled) throw new LinkError(403, "lan_disabled", "LAN communication is disabled by the owner")
      const value = await find(senderSessionID, input)
      if (value.previous) {
        if (value.previous.status.sendIntent !== intent(senderSessionID, agent, input))
          throw new LinkError(409, "envelope_conflict", "The same logical message ID belongs to a different send request")
        return safe(value.previous)
      }
      const source = await api.get({ sessionID: senderSessionID })
      const reverse = await book.currentAddress(senderSessionID)
      const envelope = { protocolVersion: 2, messageID: input.messageID, target: value.target,
        source: { installationID: book.installationID, sessionID: source.id, computer: hostname(), user: userInfo().username,
          title: source.title || source.id, agent }, replyTo: reverse,
        ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}), sentAt: Date.now(), mode: input.mode, text: input.text, attachments }
      const saved = await store.enqueue(envelope, value.address, intent(senderSessionID, agent, input), input.addressRef)
      return safe(saved)
    },
    attempt,
    async tick() {
      const pending = (await store.summaries("outbox")).filter((mail) => retryable(mail) && (mail.status.nextAttemptAt ?? 0) <= Date.now())
      // Bounded serial delivery keeps one peer from consuming all connections.
      const results = []
      for (const mail of pending) results.push(await attempt(mail.key))
      return results
    },
    async retry(key) {
      const mail = await store.get("outbox", key)
      if (!mail) throw new LinkError(404, "mail_missing", "Unknown outgoing message")
      if (mail.status.stage === "accepted" && mail.status.wakeAdvised) return safe(mail)
      await store.update("outbox", key, { stage: mail.status.stage === "accepted" ? "accepted" : "outgoing",
        code: mail.status.stage === "accepted" ? "wake_pending" : null, retryUntil: Date.now() + config().retryHours * 3600000, nextAttemptAt: null })
      return await attempt(key)
    },
    async cancel(key) {
      if (active.has(key)) throw new LinkError(409, "attempt_in_progress", "Delivery is in progress; its outcome must be reconciled before cancelling")
      const mail = await store.get("outbox", key)
      if (!mail) throw new LinkError(404, "mail_missing", "Unknown outgoing message")
      if (mail.status.stage === "accepted") throw new LinkError(409, "already_admitted", "Already delivered mail cannot be recalled from the remote branch")
      const status = await store.update("outbox", key, { stage: "cancelled", nextAttemptAt: null })
      return safe({ ...mail, status })
    },
    async close() { await Promise.allSettled([...active.values()]) },
  }
}
