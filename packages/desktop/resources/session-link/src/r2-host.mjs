import { createServer } from "node:http"
import { randomBytes, timingSafeEqual } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { openAddressBook } from "./r2-address-book.mjs"
import { openMailStore } from "./r2-mail-store.mjs"
import { openR2Database } from "./r2-database.mjs"
import { createR2Sender } from "./r2-send.mjs"
import { createR2Receiver } from "./r2-receive.mjs"
import { lanEndpoint, parseLanConfig, startLanMailbox } from "./r2-http.mjs"
import { verifyPublishedHost } from "./r2-network.mjs"
import { createOwnerOperations, parseOwnerInput } from "./r2-owner.mjs"
import { parseSend } from "./r2-tool-input.mjs"
import { LinkError } from "./policy.mjs"
import { R2_LIMITS } from "./r2-wire.mjs"
import { createR2Progress } from "./r2-progress.mjs"

const defaults = { enabled: false, host: "127.0.0.1", port: 58321, outgoingNetworks: ["192.168.0.0/16", "10.0.0.0/8", "172.16.0.0/12"], outgoingPorts: [58321], retryHours: 24 }

/** Separate local-owner credential; never grant administration to the plugin's tool token or LAN mail. */
export async function startR2Host(root, api) {
  const database = await openR2Database(root)
  const db = database.database
  const stored = db.prepare("SELECT value FROM mailbox_setting WHERE key='lan_config'").get()
  let config = parseLanConfig(stored ? JSON.parse(stored.value) : defaults)
  const book = await openAddressBook(root)
  const store = await openMailStore(root)
  const receiver = createR2Receiver({ api, book, store })
  const sender = createR2Sender({ api, book, store, config: () => config })
  const progress = await createR2Progress({ root, api, book, store, config: () => config })
  let lan
  let listenerCode
  let recoveryCode
  const listen = async () => {
    await lan?.close()
    lan = undefined
    listenerCode = undefined
    try {
      await verifyPublishedHost(config)
      lan = await startLanMailbox(config, (input) => input.envelope?.kind === "receipt" ? progress.receive(input) : receiver.receive(input))
    } catch (error) { listenerCode = error instanceof LinkError ? error.code : "listener_bind_failed" }
  }
  await listen()
  const token = randomBytes(32).toString("base64url")
  const ownerToken = randomBytes(32).toString("base64url")
  let ownerOperation
  let ownerWork = Promise.resolve()
  const local = createServer(async (request, response) => {
    const reply = (status, value) => { response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(value)) }
    if (!["/r2/tool", "/r2/owner"].includes(request.url) || request.method !== "POST") return reply(404, { error: "tool_endpoint_only" })
    const ownerRequest = request.url === "/r2/owner"
    const credential = ownerRequest ? ownerToken : token
    const received = request.headers.authorization
    if (typeof received !== "string" || Buffer.byteLength(received) !== credential.length + 7 || !timingSafeEqual(Buffer.from(received), Buffer.from(`Bearer ${credential}`)))
      return reply(401, { error: ownerRequest ? "owner_auth_required" : "local_auth_required" })
    try {
      let size = 0
      const chunks = []
      for await (const chunk of request) {
        size += chunk.length
        if (size > (ownerRequest ? 32768 : Math.ceil(R2_LIMITS.bundleBytes / 3) * 4 + 512 * 1024)) throw new LinkError(413, "mail_too_large", "Local package too large")
        chunks.push(chunk)
      }
      const input = JSON.parse(Buffer.concat(chunks).toString("utf8"))
      if (ownerRequest) {
        parseOwnerInput(input)
        const result = ownerWork.then(() => ownerOperation(input))
        ownerWork = result.catch(() => {})
        return reply(200, await result)
      }
      if (!input || !["contacts", "check", "send"].includes(input.operation) ||
        typeof input.sessionID !== "string" || !/^ses_[A-Za-z0-9_-]+$/.test(input.sessionID) ||
        typeof input.agent !== "string" || !input.agent || input.agent.length > 128)
        throw new LinkError(400, "invalid_local_input", "Invalid local tool operation")
      await api.get({ sessionID: input.sessionID })
      if (input.operation === "contacts") return reply(200, { contacts: await book.contacts(input.sessionID) })
      const message = parseSend(input.message)
      if (!message.addressRef || !message.messageID) throw new LinkError(400, "remote_fields_required", "Remote tool send needs its contact reference and stable message ID")
      const value = input.operation === "check" ? await sender.check(input.sessionID, input.agent, message) :
        await sender.send(input.sessionID, input.agent, message, input.attachments)
      reply(200, value)
    } catch (error) {
      reply(error instanceof LinkError ? error.status : 503, { error: error instanceof LinkError ? error.code : "r2_unavailable" })
    }
  })
  local.requestTimeout = 30000
  local.headersTimeout = 15000
  local.setTimeout(30000, (socket) => socket.destroy())
  await new Promise((resolve, reject) => { local.once("error", reject); local.listen(0, "127.0.0.1", resolve) })
  let stopped = false
  let timer
  let cycle = Promise.resolve()
  const work = () => {
    cycle = (async () => {
      if (!config.enabled || listenerCode) return
      await receiver.recover()
      await sender.tick()
      await progress.tick()
      recoveryCode = undefined
    })().catch(() => { recoveryCode = "mail_recovery_unavailable" }).finally(() => {
      if (!stopped) { timer = setTimeout(work, 2000); timer.unref() }
    })
  }
  work()
  const ownerSession = async (sessionID) => {
    if (typeof sessionID !== "string" || !/^ses_[A-Za-z0-9_-]+$/.test(sessionID)) throw new LinkError(400, "invalid_session", "Invalid selected branch")
    await api.get({ sessionID }).catch(() => { throw new LinkError(404, "selected_branch_unavailable", "Selected branch is unavailable on this installation") })
  }
  const publicConfig = (value = config) => ({ enabled: value.enabled, host: value.host, port: value.port,
    ...(value.publishHost !== undefined ? { publishHost: value.publishHost } : {}),
    outgoingNetworks: value.outgoingNetworks, outgoingPorts: value.outgoingPorts, retryHours: value.retryHours })
  let configurationWork = Promise.resolve()
  const host = {
    connection: { url: `http://127.0.0.1:${local.address().port}/r2/tool`, token },
    async status(sessionID) {
      if (sessionID) await ownerSession(sessionID)
      return { installationID: book.installationID, config: publicConfig(), listener: listenerCode ?? recoveryCode ?? (lan?.enabled ? "ready" : "disabled"), confidentiality: "no-tls",
        ...(sessionID ? { branchAddress: await book.addressState(sessionID) } : {}) }
    },
    configure(value) {
      const result = configurationWork.then(async () => {
        const next = parseLanConfig(value)
        if (next.enabled && next.host === "0.0.0.0") throw new LinkError(400, "explicit_interface_required", "Choose the computer's specific LAN IPv4 address, not all interfaces")
        await verifyPublishedHost(next)
        const sameBind = next.enabled === config.enabled && next.host === config.host && next.port === config.port
        if (JSON.stringify(publicConfig(next)) === JSON.stringify(publicConfig()) && !listenerCode) return await host.status()
        // Bind a changed endpoint before replacing the current one; a failed bind
        // must not strand an already working mailbox or persist unusable settings.
        const replacement = sameBind && !listenerCode ? lan : await startLanMailbox(next,
          (input) => input.envelope?.kind === "receipt" ? progress.receive(input) : receiver.receive(input))
          .catch(() => { throw new LinkError(503, "listener_bind_failed", "Cannot bind the selected mailbox interface and port") })
        try {
          db.prepare("INSERT INTO mailbox_setting(key,value) VALUES('lan_config',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(publicConfig(next)))
        } catch (error) { if (replacement !== lan) await replacement.close(); throw error }
        const previous = lan
        config = next
        lan = replacement
        if (lan?.enabled) lan.endpoint = lanEndpoint(config)
        listenerCode = undefined
        if (previous !== lan) await previous?.close()
        return await host.status()
      })
      configurationWork = result.catch(() => {})
      return result
    },
    async issueAddress(sessionID, wake) {
      await ownerSession(sessionID)
      if (!config.enabled || !lan?.enabled) throw new LinkError(403, "listener_required", "Enable a reachable mailbox before issuing branch invitations")
      return await book.issueAddress(sessionID, lan.endpoint, wake)
    },
    async copyAddress(sessionID, wake) {
      await ownerSession(sessionID)
      if (!config.enabled || !lan?.enabled) throw new LinkError(403, "listener_required", "Enable a reachable mailbox before copying a branch invitation")
      const invitation = await book.currentAddress(sessionID).catch((error) => {
        if (error instanceof LinkError && error.code === "reverse_address_missing") return undefined
        throw error
      })
      if (!invitation) return await book.issueAddress(sessionID, lan.endpoint, wake)
      if (invitation.endpoint !== lan.endpoint) throw new LinkError(409, "address_needs_reissue", "Mailbox endpoint changed; explicitly reissue this branch address")
      const { encodeInvitation } = await import("./r2-wire.mjs")
      return encodeInvitation(invitation)
    },
    async revokeAddress(sessionID) { await ownerSession(sessionID); return await book.revokeAddress(sessionID) },
    async setWake(sessionID, wake) { await ownerSession(sessionID); return await book.setWake(sessionID, wake) },
    async importContact(sessionID, invitation, label) { await ownerSession(sessionID); return await book.importContact(sessionID, invitation, label) },
    async contacts(sessionID) { await ownerSession(sessionID); return await book.contacts(sessionID) },
    async removeContact(sessionID, addressRef) { await ownerSession(sessionID); return await book.removeContact(sessionID, addressRef) },
    async mail(sessionID) {
      await ownerSession(sessionID)
      const result = []
      for (const kind of ["inbox", "outbox"]) for (const mail of await store.summaries(kind)) {
        if ((kind === "inbox" ? mail.envelope.target.sessionID : mail.envelope.source.sessionID) !== sessionID) continue
        result.push({ kind, mailKey: mail.key, messageID: mail.envelope.messageID, source: mail.envelope.source, target: mail.envelope.target,
          sentAt: mail.envelope.sentAt, mode: mail.envelope.mode, text: mail.envelope.text, status: mail.status.progress ?? mail.status.stage,
          replyKey: mail.status.replyKey ?? null, modelAttemptID: mail.status.modelAttemptID ?? null, observedAt: mail.status.observedAt ?? null,
          admissionStatus: mail.status.stage,
          attempts: mail.status.attempts, code: mail.status.code ?? null, wakeAdvised: mail.status.wakeAdvised ?? false,
          receivedAt: mail.status.receivedAt ?? null, observedIP: mail.status.observedIP ?? null,
          replyToAddressRef: mail.status.replyToAddressRef ?? null, inReplyTo: mail.envelope.inReplyTo ?? null,
          attachments: mail.envelope.attachments.map(({ base64, ...file }) => file) })
      }
      return result
    },
    async send(sessionID, value) {
      await ownerSession(sessionID)
      const message = parseSend(value)
      if (!message.addressRef || !message.messageID || message.attachments.length) throw new LinkError(400, "invalid_ui_send", "Desktop text send needs a stable ID and a granted contact; use native tools for files")
      return await sender.send(sessionID, (await api.get({ sessionID })).agent ?? "build", message, [])
    },
    retry: sender.retry,
    cancel: sender.cancel,
    async close() {
      stopped = true
      progress.close()
      clearTimeout(timer)
      await new Promise((resolve, reject) => { local.close((error) => error ? reject(error) : resolve()); local.closeAllConnections() })
      await cycle
      await ownerWork
      await configurationWork
      await lan?.close()
      await sender.close()
      database.close()
    },
  }
  ownerOperation = createOwnerOperations(root, host)
  try {
    await mkdir(path.join(root, ".private"), { recursive: true, mode: 0o700 })
    await writeFile(path.join(root, ".private", "r2-owner.json"), JSON.stringify({ protocolVersion: 1,
      url: `http://127.0.0.1:${local.address().port}/r2/owner`, token: ownerToken,
      desktopPID: process.pid, installationID: book.installationID }), { mode: 0o600 })
  } catch {
    await host.close()
    throw new LinkError(500, "owner_connection_unavailable", "Cannot publish the private local-owner connection")
  }
  return host
}
