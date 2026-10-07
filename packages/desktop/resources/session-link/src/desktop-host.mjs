import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { setTimeout } from "node:timers/promises"
import { bindingFile } from "./binding.mjs"
import { makeApi } from "./http-client.mjs"
import { startGateway } from "./gateway.mjs"
import { startObserver } from "./observer.mjs"
import { readPolicy } from "./policy.mjs"
import { startR2Host } from "./r2-host.mjs"

const packagePath = fileURLToPath(new URL("..", import.meta.url))

export async function prepareDesktopLink(root, configContent) {
  const privateDir = path.join(root, ".private")
  await mkdir(privateDir, { recursive: true })
  const policyFile = path.join(root, "policy.json")
  const connectionFile = path.join(privateDir, "connection.json")
  const existing = await readFile(policyFile, "utf8").catch((error) => {
    if (error.code === "ENOENT") return undefined
    throw error
  })
  if (existing === undefined) {
    await writeFile(policyFile, JSON.stringify({ wake: { allow: ["session:*"], deny: [] }, senders: [] }, null, 2), { flag: "wx", mode: 0o600 })
  }
  await readPolicy(policyFile)
  const config = configContent ? JSON.parse(configContent) : {}
  const environment = {
    OPENCODE_CONFIG_CONTENT: JSON.stringify({ ...config, plugins: [...(config.plugins ?? []), { package: packagePath, options: { policyFile, connectionFile, desktopBinding: true } }] }),
  }
  let running
  let r2
  return {
    environment,
    async connect({ url, password, directory }) {
      await running?.close()
      running = undefined
      r2 = undefined
      const api = makeApi(url, password, directory)
      const info = await api.requestEnvelope("GET", "/api/info")
      const normalized = (value) => {
        const resolved = path.resolve(value.startsWith("file:") ? fileURLToPath(value) : value)
        return process.platform === "win32" ? resolved.toLowerCase() : resolved
      }
      const samePath = (a, b) => typeof a === "string" && normalized(a) === normalized(b)
      const entries = await api.requestEnvelope("GET", "/api/config")
      const candidates = entries.flatMap((entry) => entry.info?.plugins ?? []).filter((plugin) => samePath(typeof plugin === "string" ? plugin : plugin.package, packagePath))
      // Earlier declarations may be legitimately superseded. The generation's
      // attestation below, not unanimity of source documents, owns the binding.
      const bound = candidates.some((plugin) => typeof plugin === "object" && samePath(plugin.options?.policyFile, policyFile) && samePath(plugin.options?.connectionFile, connectionFile))
      const unavailable = async (reason) => {
        await writeFile(path.join(root, "runtime.json"), JSON.stringify({ desktopPID: process.pid, server: url, pid: info.pid, version: info.version, status: "unavailable", reason, controls: "disabled" }, null, 2))
        return { status: "unavailable", reason }
      }
      if (!bound) return await unavailable("compatible-service-missing-session-link-binding")
      // Merely adopting a version-compatible service does not install a plugin.
      // Warm its ordinary location registry and verify the exact loaded carrier.
      await api.request("GET", "/api/agent")
      const deadline = Date.now() + 30000
      let active = false
      while (Date.now() < deadline) {
        const plugins = await api.request("GET", "/api/plugin")
        active = plugins.some((plugin) => plugin.id === "session-link" && plugin.state.status === "active" && plugin.source.type === "local" && samePath(plugin.source.path, path.join(packagePath, "index.js")))
        if (active) break
        await setTimeout(100)
      }
      if (!active) return await unavailable("session-link-plugin-not-active")
      const binding = await readFile(bindingFile(policyFile, directory), "utf8").then((text) => JSON.parse(text), (error) => { if (error.code === "ENOENT") return undefined; throw error })
      if (!binding || binding.pid !== info.pid || !samePath(binding.directory, directory) || !samePath(binding.policyFile, policyFile) || !samePath(binding.connectionFile, connectionFile)) return await unavailable("session-link-active-binding-mismatch")
      // Never trust an environment-supplied structural-control scope in Desktop.
      await writeFile(connectionFile, JSON.stringify({ url, password, directory }), { mode: 0o600 })
      const observer = startObserver(api)
      let gateway
      try {
        gateway = await startGateway({ api, policy: () => readPolicy(policyFile), observer })
        r2 = await startR2Host(root, api)
        await writeFile(connectionFile, JSON.stringify({ url, password, directory, r2: r2.connection }), { mode: 0o600 })
      } catch (error) {
        await gateway?.close()
        await r2?.close()
        await observer.close()
        throw error
      }
      running = { close: async () => { await r2.close(); await gateway.close(); await observer.close() } }
      await writeFile(path.join(root, "runtime.json"), JSON.stringify({ desktopPID: process.pid, server: url, pid: info.pid, version: info.version, status: "ready", gateway: gateway.url, policyFile, controls: "disabled" }, null, 2))
      return { status: "ready", gateway: gateway.url }
    },
    async manage(operation, input = {}) {
      if (!r2) throw new Error("R2 host is unavailable")
      if (operation === "status") return await r2.status(input.sessionID)
      if (operation === "configure") return await r2.configure(input.config)
      if (operation === "issue-address") return { invitation: await r2.issueAddress(input.sessionID, input.wake) }
      if (operation === "copy-address") return { invitation: await r2.copyAddress(input.sessionID, input.wake) }
      if (operation === "revoke-address") return await r2.revokeAddress(input.sessionID)
      if (operation === "set-wake") return await r2.setWake(input.sessionID, input.wake)
      if (operation === "import-contact") return await r2.importContact(input.sessionID, input.invitation, input.label)
      if (operation === "contacts") return { contacts: await r2.contacts(input.sessionID) }
      if (operation === "remove-contact") return await r2.removeContact(input.sessionID, input.addressRef)
      if (operation === "mail") return { mail: await r2.mail(input.sessionID) }
      if (operation === "send") return await r2.send(input.sessionID, input.message)
      if (operation === "retry") return await r2.retry(input.mailKey)
      if (operation === "cancel") return await r2.cancel(input.mailKey)
      throw new Error("Unknown R2 owner operation")
    },
    async close() { await running?.close(); running = undefined },
  }
}
