import { LinkError } from "./policy.mjs"
import { deliverHttp } from "./r2-http.mjs"

const states = ["accepted", "processing", "completed", "failed", "interrupted", "outcome_unknown"]
const keyPattern = /^[a-f0-9]{64}$/

/** Technical receipt is never synthetic input and cannot grant a contact or wake. */
export function parseProgress(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) =>
    !["kind", "protocolVersion", "mailKey", "envelopeHash", "source", "target", "sequence", "status", "observedAt", "nativeInboxID", "modelAttemptID"].includes(key)) ||
    value.kind !== "receipt" || value.protocolVersion !== 2 || !keyPattern.test(value.mailKey) || !keyPattern.test(value.envelopeHash) ||
    !Number.isSafeInteger(value.sequence) || value.sequence < 0 || !states.includes(value.status) ||
    !Number.isSafeInteger(value.observedAt) || value.observedAt < 0 || value.nativeInboxID !== `msg_${value.mailKey}` ||
    (value.modelAttemptID !== undefined && (typeof value.modelAttemptID !== "string" || !/^evt_[A-Za-z0-9_-]+$/.test(value.modelAttemptID))) ||
    [value.source, value.target].some((identity) => !identity || typeof identity !== "object" || Array.isArray(identity) ||
      Object.keys(identity).some((key) => !["installationID", "sessionID"].includes(key)) ||
      !/^ins_[a-f0-9-]{36}$/.test(identity.installationID) || !/^ses_[A-Za-z0-9_-]+$/.test(identity.sessionID)))
    throw new LinkError(400, "invalid_receipt", "Invalid exact technical receipt")
  return value
}

export async function createR2Progress({ root, api, book, store, config }) {
  const abort = new AbortController()
  const active = new Map()
  const saveReceipt = async (mail, status, sequence, observedAt, modelAttemptID) => {
    const receipt = parseProgress({ kind: "receipt", protocolVersion: 2, mailKey: mail.key, envelopeHash: mail.hash,
      source: mail.envelope.target, target: { installationID: mail.envelope.source.installationID, sessionID: mail.envelope.source.sessionID },
      sequence, status, observedAt, nativeInboxID: `msg_${mail.key}`, ...(modelAttemptID ? { modelAttemptID } : {}) })
    await store.update("inbox", mail.key, { progress: status, progressSequence: sequence, observedAt, modelAttemptID: modelAttemptID ?? null, receiptBytes: JSON.stringify(receipt) })
  }
  return {
    async receive(input) {
      const receipt = parseProgress(input.envelope)
      const previous = active.get(receipt.mailKey) ?? Promise.resolve()
      const result = previous.catch(() => {}).then(async () => {
      const mail = await store.get("outbox", receipt.mailKey)
      if (!mail || mail.hash !== receipt.envelopeHash ||
        receipt.source.installationID !== mail.envelope.target.installationID || receipt.source.sessionID !== mail.envelope.target.sessionID ||
        receipt.target.installationID !== mail.envelope.source.installationID || receipt.target.sessionID !== mail.envelope.source.sessionID ||
        input.capabilityID !== mail.envelope.replyTo.capabilityID)
        throw new LinkError(409, "receipt_binding_conflict", "Receipt does not belong to this exact retained mail and reverse capability")
      await book.authorize(input.capabilityID, input.secret, receipt.target, "queue")
      if ((mail.status.receiptSequence ?? -1) < receipt.sequence) {
        await store.update("outbox", mail.key, { stage: "accepted", nativeInboxID: receipt.nativeInboxID,
          progress: receipt.status, observedAt: receipt.observedAt, modelAttemptID: receipt.modelAttemptID ?? null, receiptSequence: receipt.sequence })
      }
      return { status: "receipt_saved", mailKey: receipt.mailKey, sequence: receipt.sequence, envelopeHash: receipt.envelopeHash }
      })
      active.set(receipt.mailKey, result)
      void result.finally(() => { if (active.get(receipt.mailKey) === result) active.delete(receipt.mailKey) }).catch(() => {})
      return await result
    },
    async tick() {
       const inbox = await store.summaries("inbox")
       const incoming = inbox.filter((mail) => mail.status.nativeInboxID && !["completed", "failed", "interrupted"].includes(mail.status.progress))
      const sessions = [...new Set(incoming.map((mail) => mail.envelope.target.sessionID))]
      for (const sessionID of sessions) {
        // Native event-log persistence is optional and OFF in a normal service.
        // Use the complete paged durable timeline, not the current model-context
        // window (which hides witnesses after compaction), empty log or idle
        // inference. The assistant carries IDs from each exact primary attempt;
        // only an explicit idle message with the same execution identity owns
        // the outcome; a missing ID or a neighbouring terminal is not a join.
        const messages = []
        const readable = await (async () => {
          let cursor
          do {
            const query = new URLSearchParams({ limit: "200", ...(cursor ? { cursor } : { order: "asc" }) })
            const page = await api.requestEnvelope("GET", `/api/session/${sessionID}/message?${query}`, undefined, abort.signal)
            messages.push(...page.data)
            cursor = page.cursor?.next
          } while (cursor)
          return true
        })().catch(() => false)
        if (!readable) continue
        for (const mail of incoming.filter((mail) => mail.envelope.target.sessionID === sessionID)) {
          if (["completed", "failed", "interrupted"].includes(mail.status.progress)) continue
          const witnesses = messages.flatMap((message) => message.type === "assistant" ? (message.metadata?.requestAttempts ?? [])
            .filter((attempt) => attempt.inputMessageIDs?.includes(mail.status.nativeInboxID)).map((attempt) => ({ attempt,
              idle: attempt.executionID ? messages.find((message) => message.type === "idle" && message.metadata?.executionID === attempt.executionID) : undefined })) : [])
          const witness = witnesses.find((witness) => witness.idle) ?? witnesses[0]
          if (!witness) continue
          const { attempt, idle } = witness
          if (!["processing", "outcome_unknown"].includes(mail.status.progress) || mail.status.modelAttemptID !== attempt.id)
            await saveReceipt(mail, "processing", (mail.status.progressSequence ?? 0) + 1, attempt.started, attempt.id)
          if (!idle) {
            if (messages.some((message) => message.type === "idle" && message.time.created >= attempt.started && (!attempt.executionID || message.metadata?.executionID !== attempt.executionID)) && mail.status.progress !== "outcome_unknown") {
               const current = { ...mail, status: await store.state("inbox", mail.key) }
              await saveReceipt(current, "outcome_unknown", (current.status.progressSequence ?? 0) + 1, Date.now(), attempt.id)
            }
            continue
          }
           const current = { ...mail, status: await store.state("inbox", mail.key) }
          const state = idle.outcome === "succeeded" ? "completed" : idle.outcome === "failed" ? "failed" : idle.outcome === "interrupted" ? "interrupted" : undefined
          if (state) await saveReceipt(current, state, current.status.progressSequence + 1, idle.time.created, attempt.id)
        }
      }
       const observed = await store.summaries("inbox")
       for (const mail of observed) {
        if (!mail.status.nativeInboxID) continue
        if (!mail.status.receiptBytes) await saveReceipt(mail, "accepted", 0, mail.status.receivedAt)
         const latest = await store.state("inbox", mail.key)
         const receipt = parseProgress(JSON.parse(latest.receiptBytes))
         if (receipt.sequence <= (latest.receiptSentSequence ?? -1) || (latest.receiptNextAttemptAt ?? 0) > Date.now()) continue
         await store.update("inbox", mail.key, { receiptNextAttemptAt: Date.now() + 10000 })
         const retained = await store.get("inbox", mail.key)
         const acknowledgement = await deliverHttp(config(), retained.envelope.replyTo, Buffer.from(latest.receiptBytes), abort.signal).catch(() => undefined)
        if (acknowledgement?.status === "receipt_saved" && acknowledgement.mailKey === mail.key && acknowledgement.envelopeHash === mail.hash && acknowledgement.sequence === receipt.sequence)
          await store.update("inbox", mail.key, { receiptSentSequence: receipt.sequence })
      }
       const outbox = await store.summaries("outbox")
       for (const reply of observed) {
        const relation = reply.envelope.inReplyTo
        if (!relation || !reply.status.nativeInboxID) continue
         for (const original of outbox) {
          if (original.envelope.source.installationID !== relation.installationID || original.envelope.source.sessionID !== relation.sessionID || original.envelope.messageID !== relation.messageID ||
            original.envelope.target.installationID !== reply.envelope.source.installationID || original.envelope.target.sessionID !== reply.envelope.source.sessionID ||
            original.envelope.source.installationID !== reply.envelope.target.installationID || original.envelope.source.sessionID !== reply.envelope.target.sessionID) continue
          if (!original.status.replyKey) await store.update("outbox", original.key, { replyKey: reply.key })
        }
      }
    },
    close() { abort.abort() },
  }
}
