import { mkdir, readFile, writeFile, open } from "node:fs/promises"
import { createHash } from "node:crypto"
import path from "node:path"
import { isIP } from "node:net"
import { decodeInvitation } from "./r2-wire.mjs"
import { parseLanConfig, parsePublishedHost } from "./r2-http.mjs"
import { discoverLan } from "./r2-network.mjs"
import { LinkError } from "./policy.mjs"

const fields = {
  status: ["sessionID"], discover: ["peer", "bind", "publishHost"], configure: ["config"],
  prepare: ["sessionID", "peer", "bind", "publishHost", "port", "wake"],
  "export-address": ["sessionID"], "reissue-address": ["sessionID", "wake"],
  "import-contact": ["sessionID", "file", "label"], "set-wake": ["sessionID", "wake"],
}

export function parseOwnerInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || !fields[input.operation] || Object.keys(input).some((key) => key !== "operation" && !fields[input.operation].includes(key)))
    throw new LinkError(400, "invalid_owner_input", "Unknown local owner operation or fields")
  if (input.sessionID !== undefined && (typeof input.sessionID !== "string" || !/^ses_[A-Za-z0-9_-]+$/.test(input.sessionID)))
    throw new LinkError(400, "invalid_session", "An exact existing branch ID is required")
  if (!["status", "discover", "configure"].includes(input.operation) && input.sessionID === undefined)
    throw new LinkError(400, "invalid_session", "An exact existing branch ID is required")
  if (input.wake !== undefined && typeof input.wake !== "boolean") throw new LinkError(400, "invalid_wake", "Wake must be boolean")
  if (input.operation === "set-wake" && input.wake === undefined) throw new LinkError(400, "invalid_wake", "Wake must be explicit")
  if (input.peer !== undefined) parsePublishedHost(input.peer)
  if (input.publishHost !== undefined) parsePublishedHost(input.publishHost)
  if (input.bind !== undefined && isIP(input.bind) !== 4) throw new LinkError(400, "invalid_lan_config", "Bind must be a local IPv4")
  if (input.port !== undefined && (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535)) throw new LinkError(400, "invalid_lan_config", "Invalid mailbox port")
  if (input.operation === "configure") parseLanConfig(input.config)
  if (input.operation === "import-contact" && (typeof input.file !== "string" || !path.isAbsolute(input.file) || typeof input.label !== "string" || !input.label.trim() || input.label.length > 512))
    throw new LinkError(400, "invalid_owner_input", "Import requires an absolute private file path and contact label")
  return input
}

export function createOwnerOperations(root, host) {
  const exportAddress = async (sessionID, invitation) => {
    const decoded = decodeInvitation(invitation)
    const directory = path.join(root, ".private", "invitations")
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const file = path.join(directory, `${sessionID}-${decoded.capabilityID}.private-address.txt`)
    const bytes = Buffer.from(`${invitation}\n`, "utf8")
    await writeFile(file, bytes, { flag: "wx", mode: 0o600 }).catch(async (error) => {
      if (error.code !== "EEXIST") throw new LinkError(500, "private_file_unavailable", "Cannot save the private invitation carrier")
      if (!(await readFile(file)).equals(bytes)) throw new LinkError(409, "private_file_conflict", "Existing private invitation carrier differs; it was not overwritten")
    })
    return { ...(await host.status(sessionID)), file: { path: file, bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex") }, endpoint: decoded.endpoint }
  }
  return async (input) => {
    if (input.operation === "status") return await host.status(input.sessionID)
    if (input.operation === "configure") return await host.configure(input.config)
    if (input.operation === "set-wake") return await host.setWake(input.sessionID, input.wake)
    if (input.operation === "discover") return await discoverLan(parseLanConfig((await host.status()).config), input)
    if (input.operation === "prepare") {
      // Verify selected branch before any installation-global configuration change.
      const status = await host.status(input.sessionID)
      const selected = await discoverLan(parseLanConfig(status.config), input)
      const result = await host.configure({ ...status.config, enabled: true, host: selected.host,
        publishHost: selected.publishHost, port: input.port ?? status.config.port })
      if (result.listener !== "ready") throw new LinkError(503, "listener_bind_failed", "Mailbox listener is not ready")
      const invitation = await host.copyAddress(input.sessionID, input.wake ?? false)
      if (input.wake !== undefined) await host.setWake(input.sessionID, input.wake)
      return { ...(await exportAddress(input.sessionID, invitation)), network: selected }
    }
    if (input.operation === "export-address") return await exportAddress(input.sessionID, await host.copyAddress(input.sessionID))
    if (input.operation === "reissue-address") return await exportAddress(input.sessionID, await host.issueAddress(input.sessionID, input.wake ?? false))
    if (input.operation === "import-contact") {
      await host.status(input.sessionID)
      const file = await open(input.file, "r").catch(() => { throw new LinkError(400, "private_file_unavailable", "Cannot open the colleague's private invitation file") })
      try {
        const metadata = await file.stat()
        if (!metadata.isFile() || metadata.size > 8192) throw new LinkError(400, "invalid_private_file", "Invitation carrier must be a text file no larger than 8192 bytes")
        const invitation = (await file.readFile("utf8")).trim()
        return { contact: await host.importContact(input.sessionID, invitation, input.label) }
      } finally { await file.close() }
    }
    throw new LinkError(400, "invalid_owner_input", "Unknown local owner operation")
  }
}
