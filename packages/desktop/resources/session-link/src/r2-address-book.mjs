import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto"
import { decodeInvitation, encodeInvitation, parseEndpoint, parseInvitation } from "./r2-wire.mjs"
import { LinkError, tokenHash } from "./policy.mjs"
import { openR2Database } from "./r2-database.mjs"

const session = (value) => {
  if (typeof value !== "string" || !/^ses_[A-Za-z0-9_-]+$/.test(value)) throw new LinkError(400, "invalid_session", "Invalid branch ID")
  return value
}

export async function openAddressBook(root) {
  const store = await openR2Database(root)
  const db = store.database
  store.transaction(() => db.prepare("INSERT OR IGNORE INTO mailbox_setting(key, value) VALUES('installation_id', ?)").run(`ins_${randomUUID()}`))
  const installationID = db.prepare("SELECT value FROM mailbox_setting WHERE key='installation_id'").get().value
  if (!/^ins_[a-f0-9-]{36}$/.test(installationID)) throw new Error("Invalid private R2 installation identity; not recreating it")
  const safeContact = (contact) => {
    const invitation = JSON.parse(contact.invitation)
    return { addressRef: contact.address_ref, label: contact.label,
      target: { installationID: invitation.installationID, sessionID: invitation.sessionID } }
  }
  return {
    installationID,
    // The owner-facing adapter verifies an existing branch and enabled endpoint
    // before calling this mutation. This module creates no Session or listener.
    async issueAddress(sessionID, endpoint, wake = false) {
      session(sessionID)
      parseEndpoint(endpoint)
      if (typeof wake !== "boolean") throw new LinkError(400, "invalid_wake", "Wake must be explicit")
      return store.transaction(() => {
        db.prepare("UPDATE capability SET revoked=1 WHERE session_id=?").run(sessionID)
        const invitation = parseInvitation({ protocolVersion: 2, endpoint, installationID,
          sessionID, capabilityID: `cap_${randomUUID()}`, secret: randomBytes(32).toString("base64url") })
        db.prepare("INSERT INTO capability(id, session_id, invitation, secret_hash, wake, revoked) VALUES(?, ?, ?, ?, ?, 0)")
          .run(invitation.capabilityID, sessionID, JSON.stringify(invitation), tokenHash(invitation.secret), Number(wake))
        return encodeInvitation(invitation)
      })
    },
    async currentAddress(sessionID) {
      session(sessionID)
      const capability = db.prepare("SELECT invitation FROM capability WHERE session_id=? AND revoked=0").get(sessionID)
      if (!capability) throw new LinkError(403, "reverse_address_missing", "The sending branch needs an active reverse address")
      return parseInvitation(JSON.parse(capability.invitation))
    },
    async addressState(sessionID) {
      session(sessionID)
      const capability = db.prepare("SELECT wake FROM capability WHERE session_id=? AND revoked=0").get(sessionID)
      return { active: Boolean(capability), wake: Boolean(capability?.wake) }
    },
    async revokeAddress(sessionID) {
      session(sessionID)
      db.prepare("UPDATE capability SET revoked=1 WHERE session_id=?").run(sessionID)
      return { revoked: true, sessionID }
    },
    async setWake(sessionID, wake) {
      session(sessionID)
      if (typeof wake !== "boolean") throw new LinkError(400, "invalid_wake", "Wake must be explicit")
      db.prepare("UPDATE capability SET wake=? WHERE session_id=? AND revoked=0").run(Number(wake), sessionID)
      return { sessionID, wake }
    },
    // Recovery and retries must call this again immediately before advising wake.
    async authenticate(capabilityID, secret, target) {
      if (typeof capabilityID !== "string" || !/^cap_[a-f0-9-]{36}$/.test(capabilityID))
        throw new LinkError(401, "address_unavailable", "Unknown, revoked or mismatched branch address")
      const capability = db.prepare("SELECT * FROM capability WHERE id=?").get(capabilityID)
      const digest = typeof secret === "string" ? tokenHash(secret) : "0".repeat(64)
      if (!capability || !timingSafeEqual(Buffer.from(capability.secret_hash, "hex"), Buffer.from(digest, "hex")) ||
        target.installationID !== installationID || target.sessionID !== capability.session_id)
        throw new LinkError(401, "address_unavailable", "Unknown, revoked or mismatched branch address")
      return { targetSessionID: capability.session_id, revoked: Boolean(capability.revoked), wake: Boolean(capability.wake) }
    },
    async authorize(capabilityID, secret, target, mode) {
      const capability = await this.authenticate(capabilityID, secret, target)
      if (capability.revoked) throw new LinkError(401, "address_unavailable", "Unknown, revoked or mismatched branch address")
      if (!["wake", "queue", "steer"].includes(mode)) throw new LinkError(400, "invalid_mode", "Unknown mail mode")
      if (mode !== "queue" && !capability.wake) throw new LinkError(403, "wake_denied", "This branch address does not currently allow wake or steer")
      return { targetSessionID: capability.targetSessionID, wake: capability.wake }
    },
    async authorizeRetained(capabilityID, target, mode) {
      const row = db.prepare("SELECT invitation FROM capability WHERE id=?").get(capabilityID)
      if (!row) throw new LinkError(401, "address_unavailable", "Retained delivery capability is unavailable")
      // Only the local host calls this for a previously authenticated node snapshot.
      const invitation = parseInvitation(JSON.parse(row.invitation))
      return await this.authorize(capabilityID, invitation.secret, target, mode)
    },
    async importContact(senderSessionID, encoded, label) {
      session(senderSessionID)
      const invitation = typeof encoded === "string" ? decodeInvitation(encoded) : parseInvitation(encoded)
      if (typeof label !== "string" || !label.trim() || label.length > 512) throw new LinkError(400, "invalid_label", "Contact needs a short label")
      return store.transaction(() => {
        const existing = db.prepare("SELECT * FROM contact WHERE sender_session_id=?").all(senderSessionID).find((item) => {
          const current = JSON.parse(item.invitation)
          return current.installationID === invitation.installationID && current.sessionID === invitation.sessionID && current.capabilityID === invitation.capabilityID
        })
        const addressRef = existing?.address_ref ?? `addr_${randomUUID()}`
        db.prepare("INSERT INTO contact(address_ref, sender_session_id, invitation, label) VALUES(?, ?, ?, ?) ON CONFLICT(address_ref) DO UPDATE SET invitation=excluded.invitation, label=excluded.label")
          .run(addressRef, senderSessionID, JSON.stringify(invitation), label)
        return safeContact({ address_ref: addressRef, label, invitation: JSON.stringify(invitation) })
      })
    },
    async contacts(senderSessionID) {
      session(senderSessionID)
      return db.prepare("SELECT * FROM contact WHERE sender_session_id=?").all(senderSessionID).map(safeContact)
    },
    async resolveContact(senderSessionID, addressRef) {
      session(senderSessionID)
      const contact = db.prepare("SELECT invitation FROM contact WHERE address_ref=? AND sender_session_id=?").get(addressRef, senderSessionID)
      if (!contact) throw new LinkError(403, "contact_denied", "Contact is not granted to this sending branch")
      return parseInvitation(JSON.parse(contact.invitation))
    },
    async removeContact(senderSessionID, addressRef) {
      session(senderSessionID)
      const result = db.prepare("DELETE FROM contact WHERE address_ref=? AND sender_session_id=?").run(addressRef, senderSessionID)
      if (!result.changes) throw new LinkError(403, "contact_denied", "Contact is not granted to this sending branch")
      return { addressRef, removed: true }
    },
  }
}
