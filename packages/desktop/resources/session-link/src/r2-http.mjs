import { createServer, request } from "node:http"
import { request as secureRequest } from "node:https"
import { lookup } from "node:dns"
import { BlockList, isIP } from "node:net"
import { LinkError } from "./policy.mjs"
import { parseEndpoint, R2_MAIL_PATH, R2_LIMITS } from "./r2-wire.mjs"

const maxBody = Math.ceil(R2_LIMITS.bundleBytes / 3) * 4 + 512 * 1024

/** Explicit owner configuration; never widen the existing loopback OpenCode API. */
export function parseLanConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !["enabled", "host", "publishHost", "port", "outgoingNetworks", "outgoingPorts", "retryHours"].includes(key)))
    throw new LinkError(400, "invalid_lan_config", "Invalid LAN mailbox configuration")
  if (typeof value.enabled !== "boolean" || isIP(value.host) !== 4 || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535)
    throw new LinkError(400, "invalid_lan_config", "LAN needs explicit enablement, IPv4 bind address and stable port")
  if (!Array.isArray(value.outgoingPorts) || !value.outgoingPorts.length || value.outgoingPorts.some((port) => !Number.isInteger(port) || port < 1 || port > 65535))
    throw new LinkError(400, "invalid_lan_config", "Outgoing mailbox ports must be explicitly allowed")
  if (!Array.isArray(value.outgoingNetworks) || !value.outgoingNetworks.length)
    throw new LinkError(400, "invalid_lan_config", "Outgoing working networks must be explicitly allowed")
  const networks = new BlockList()
  for (const entry of value.outgoingNetworks) {
    if (typeof entry !== "string") throw new LinkError(400, "invalid_lan_config", "Invalid IPv4 network")
    const match = entry.match(/^([^/]+)\/(\d{1,2})$/)
    if (!match || isIP(match[1]) !== 4 || Number(match[2]) < 0 || Number(match[2]) > 32)
      throw new LinkError(400, "invalid_lan_config", "Outgoing networks must use explicit IPv4 CIDR notation")
    networks.addSubnet(match[1], Number(match[2]), "ipv4")
  }
  const retryHours = value.retryHours ?? 24
  if (value.publishHost !== undefined) parsePublishedHost(value.publishHost)
  if (!Number.isFinite(retryHours) || retryHours < 0 || retryHours > 720) throw new LinkError(400, "invalid_lan_config", "Automatic retry period must be 0–720 hours")
  return { ...value, retryHours, networks }
}

export function parsePublishedHost(value) {
  if (typeof value !== "string" || value.length > 253 || !/^[A-Za-z0-9_](?:[A-Za-z0-9_.-]*[A-Za-z0-9_])?$/.test(value) || value.split(".").some((label) => !label || label.length > 63))
    throw new LinkError(400, "invalid_publish_host", "Published address needs a computer name, DNS name or IPv4, without protocol, port or path")
  return value
}

// Invitations canonicalize through URL too: Windows computer-name case and
// default ports must not make the same active reverse address appear stale.
export const lanEndpoint = (config) => parseEndpoint(`http://${config.publishHost ?? config.host}:${config.port}${R2_MAIL_PATH}`)

export async function deliverHttp(config, invitation, bytes, signal) {
  if (!config.enabled) throw new LinkError(403, "lan_disabled", "LAN communication is disabled by the owner")
  const url = new URL(parseEndpoint(invitation.endpoint))
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80))
  if (!config.outgoingPorts.includes(port)) throw new LinkError(403, "network_denied", "Mailbox port is outside the configured outgoing boundary")
  const controller = AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : [])])
  const addresses = await new Promise((resolve, reject) => {
    controller.throwIfAborted()
    const abort = () => reject(controller.reason)
    controller.addEventListener("abort", abort, { once: true })
    lookup(url.hostname, { all: true, family: 4 }, (error, addresses) => {
      controller.removeEventListener("abort", abort)
       if (error) reject(new LinkError(502, "dns_lookup_failed", "Mailbox computer name cannot be resolved to IPv4"))
      else resolve(addresses)
    })
  })
  controller.throwIfAborted()
  if (!addresses.length || addresses.some((address) => !config.networks.check(address.address, "ipv4")))
    throw new LinkError(403, "network_denied", "Mailbox endpoint is outside the configured working network")
  // DNS is resolved and checked once per attempt, then the request is pinned to
  // that address. A reverse invitation cannot cause a redirect or DNS rebinding.
  return await new Promise((resolve, reject) => {
    const send = url.protocol === "https:" ? secureRequest : request
    const outgoing = send({ protocol: url.protocol, hostname: addresses[0].address, port, method: "POST", path: R2_MAIL_PATH,
      ...(url.protocol === "https:" ? { servername: url.hostname } : {}),
      headers: { host: url.host, "content-type": "application/json", "content-length": bytes.length,
        authorization: `Bearer ${invitation.secret}`, "x-session-link-capability": invitation.capabilityID }, signal: controller }, (response) => {
      const chunks = []
      let size = 0
      response.on("data", (chunk) => {
        size += chunk.length
        if (size > 65536) { response.destroy(); reject(new LinkError(502, "invalid_receipt", "Mailbox receipt exceeds its size limit")); return }
        chunks.push(chunk)
      })
      response.on("error", reject)
      response.on("end", () => {
        if (response.statusCode !== 202) {
          // Do not echo arbitrary peer response bodies, headers, redirects or secrets.
          reject(new LinkError(response.statusCode ?? 502, "remote_refusal", `Mailbox returned HTTP ${response.statusCode ?? 502}`))
          return
        }
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))) }
        catch { reject(new LinkError(502, "invalid_receipt", "Mailbox returned an invalid receipt")) }
      })
    })
    outgoing.on("error", reject)
    outgoing.end(bytes)
  })
}

export async function startLanMailbox(config, receive) {
  if (!config.enabled) return { enabled: false, close: async () => {} }
  let active = 0
  const attempts = new Map()
  const server = createServer(async (incoming, response) => {
    const reply = (status, body) => {
      response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" })
      response.end(JSON.stringify(body))
    }
    if (incoming.url !== R2_MAIL_PATH || incoming.method !== "POST") return reply(404, { error: "mail_endpoint_only" })
    const now = Date.now()
    for (const [ip, period] of attempts) if (now - period.start >= 60000) attempts.delete(ip)
    const ip = incoming.socket.remoteAddress
    const period = attempts.get(ip) ?? { start: now, count: 0 }
    if (period.count >= 30 || (!attempts.has(ip) && attempts.size >= 4096)) return reply(429, { error: "mail_rate_limit" })
    period.count++
    attempts.set(ip, period)
    if (active >= 2) return reply(429, { error: "mailbox_busy" })
    active++
    try {
      if (!incoming.headers["content-type"]?.startsWith("application/json")) throw new LinkError(415, "json_required", "Mailbox expects JSON")
      const chunks = []
      let size = 0
      for await (const chunk of incoming) {
        size += chunk.length
        if (size > maxBody) throw new LinkError(413, "mail_too_large", "Mailbox package exceeds its limit")
        chunks.push(chunk)
      }
      const envelope = (() => { try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) } catch { throw new LinkError(400, "invalid_json", "Invalid mailbox JSON") } })()
      const authorization = incoming.headers.authorization
      const secret = typeof authorization === "string" && authorization.startsWith("Bearer ") ? authorization.slice(7) : ""
      const receipt = await receive({ envelope, capabilityID: incoming.headers["x-session-link-capability"], secret,
        observedIP: incoming.socket.remoteAddress, receivedAt: Date.now() })
      reply(202, receipt)
    } catch (error) {
      reply(error instanceof LinkError ? error.status : 503, { error: error instanceof LinkError ? error.code : "mailbox_unavailable" })
    } finally { active-- }
  })
  server.headersTimeout = 15000
  server.requestTimeout = 30000
  server.setTimeout(30000, (socket) => socket.destroy())
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(config.port, config.host, () => { server.off("error", reject); resolve() }) })
  return { enabled: true, endpoint: lanEndpoint(config),
    close: () => new Promise((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections() }) }
}
