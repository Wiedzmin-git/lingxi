import { LinkError } from "./policy.mjs"
import { envelopeIdentity, parseEnvelope } from "./r2-wire.mjs"
import { consultationHeader } from "./consultation-policy.mjs"

/** One host-local receive/recovery coordinator; no remote control or runner replacement. */
export function createR2Receiver({ api, book, store }) {
  const active = new Map()
  const serialized = (key, apply) => {
    const previous = active.get(key) ?? Promise.resolve()
    const result = previous.catch(() => {}).then(apply)
    active.set(key, result)
    void result.finally(() => { if (active.get(key) === result) active.delete(key) }).catch(() => {})
    return result
  }

  const admit = async (mail) => {
    const envelope = mail.envelope
    const target = await api.get({ sessionID: envelope.target.sessionID })
    const id = `msg_${mail.key}`
    // Reconcile lost admission results without inheriting a now-revoked wake
    // grant. A native ID already recorded is durable evidence; if its HTTP
    // result was lost, inspect pending input/history before any fresh admission.
    const nativeExisting = mail.status.nativeInboxID ? { id: mail.status.nativeInboxID } :
      (await api.request("GET", `/api/session/${target.id}/inbox`)).find((item) => item.id === id) ??
      await api.request("GET", `/api/session/${target.id}/message/${id}`).catch((error) => {
        if (error instanceof LinkError && error.status === 404) return undefined
        throw error
      })
    if (!nativeExisting) {
      await book.authorizeRetained(mail.status.capabilityID, envelope.target, envelope.mode)
      if (target.revert) throw new LinkError(409, "revert_staged", "Resolve the recipient's staged revert before receiving mail")
    }
    // Grant the reverse contact once. A retry reconciles admission, not an
    // owner's later removal of this grant or the original native metadata.
    const contact = mail.status.replyToAddressRef ? { addressRef: mail.status.replyToAddressRef } :
      await book.importContact(envelope.target.sessionID, envelope.replyTo, `${envelope.source.computer} · ${envelope.source.title}`)
    if (!mail.status.replyToAddressRef) mail.status = await store.update("inbox", mail.key, { replyToAddressRef: contact.addressRef })
    const attachments = await store.materializeInbox(mail.key)
    const source = {
      ...envelope.source, identityEvidence: "remote-installation-assertion", authority: "colleague-consultation",
      messageID: envelope.messageID, mailKey: mail.key,
      observedIP: mail.status.observedIP, sentAt: envelope.sentAt, receivedAt: mail.status.receivedAt,
      replyToAddressRef: contact.addressRef,
    }
    const input = {
      sessionID: envelope.target.sessionID,
      id,
      description: `Colleague consultation from ${envelope.source.computer} · ${envelope.source.title}`,
      text: [
        consultationHeader,
        `Message source: ${JSON.stringify(source)}`,
        `Delivery: ${envelope.mode}`,
        ...(envelope.inReplyTo ? [`In reply to: ${JSON.stringify(envelope.inReplyTo)}`] : []),
        ...attachments.map((file) => `Received attachment (not executed or applied): ${JSON.stringify(file)}`),
        "", envelope.text,
      ].join("\n"),
      metadata: { source: "session-link-r2", sessionLink: { protocolVersion: 2, ...source,
        mode: envelope.mode, messageID: envelope.messageID, mailKey: mail.key,
        ...(envelope.inReplyTo ? { inReplyTo: envelope.inReplyTo } : {}), attachments } },
      delivery: envelope.mode === "steer" ? "steer" : "queue",
      resume: false,
    }
    const native = nativeExisting ?? await api.synthetic(input)
    // This is the first point allowed to claim delivery to the branch.
    await store.update("inbox", mail.key, { stage: "accepted", nativeInboxID: native.id, replyToAddressRef: contact.addressRef })
    let wakeAdvised = mail.status.wakeAdvised === true
    let code
    if (envelope.mode !== "queue" && !wakeAdvised) {
      try {
        // Re-check after admission too: a concurrent revoke must not inherit a stale grant.
        await book.authorizeRetained(mail.status.capabilityID, envelope.target, envelope.mode)
        await api.synthetic({ ...input, resume: true })
        wakeAdvised = true
      } catch (error) {
        code = error instanceof LinkError ? error.code : "wake_pending"
      }
    }
    await store.update("inbox", mail.key, { wakeAdvised, ...(code ? { code } : {}) })
    return { status: "accepted", mailKey: mail.key, envelopeHash: mail.hash, target: envelope.target,
      nativeInboxID: native.id, mode: envelope.mode, wakeAdvised, ...(code ? { code } : {}) }
  }

  return {
    async receive(input) {
      const envelope = parseEnvelope(input.envelope)
      const key = envelopeIdentity(envelope)
      return await serialized(key, async () => {
        // A retained retry authenticates the original secret, but can only
        // reconcile existing admission until current authority permits more.
        const previous = await store.get("inbox", key)
        if (previous?.status.capabilityID === input.capabilityID)
          await book.authenticate(input.capabilityID, input.secret, envelope.target)
        else await book.authorize(input.capabilityID, input.secret, envelope.target, envelope.mode)
        const mail = await store.stageIncoming(envelope)
        if (mail.status.capabilityID && mail.status.capabilityID !== input.capabilityID)
          throw new LinkError(409, "delivery_binding_conflict", "Retained mail belongs to a different delivery capability")
        if (!mail.status.capabilityID) {
          mail.status = await store.update("inbox", key, { capabilityID: input.capabilityID,
            observedIP: input.observedIP, receivedAt: input.receivedAt })
        }
        return await admit(mail)
      })
    },
    async recover() {
      const results = []
      for (const mail of await store.summaries("inbox")) {
        if (!mail.status.capabilityID || (mail.status.stage === "accepted" && (mail.envelope.mode === "queue" || mail.status.wakeAdvised))) continue
        const result = await serialized(mail.key, async () => admit(await store.get("inbox", mail.key))).then(
          (receipt) => ({ key: mail.key, receipt }),
          (error) => ({ key: mail.key, code: error instanceof LinkError ? error.code : "recovery_pending" }),
        )
        results.push(result)
      }
      return results
    },
  }
}
