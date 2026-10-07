import { readPolicy } from "./policy.mjs"
import { deliver, messageSchema, parseMessage } from "./delivery.mjs"
import { readFile, rename, unlink, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { bindingFile } from "./binding.mjs"
import { makeApi } from "./http-client.mjs"
import { control, controlSchema, inspect, parseControl } from "./controls.mjs"
import { parseSend, sendSchema, snapshotAttachments } from "./r2-tool-input.mjs"
import { LinkError } from "./policy.mjs"
import { registerConsultationPolicy } from "./consultation-policy.mjs"

// Plugin.define is an identity wrapper in V2. A plain exported definition avoids
// a runtime dependency and can load in the existing compiled Windows CLI.
export default {
  id: "session-link",
  async setup(ctx) {
    const policyFile = ctx.options.policyFile
    if (typeof policyFile !== "string") throw new Error("session-link requires an explicit policyFile")
    await readPolicy(policyFile)
    await registerConsultationPolicy(ctx.session)
    async function nativeClient() {
      if (typeof ctx.options.connectionFile !== "string") throw new Error("This tool requires an explicit connectionFile")
      const connection = JSON.parse(await readFile(ctx.options.connectionFile, "utf8"))
      return { api: makeApi(connection.url, connection.password, ctx.location?.directory ?? connection.directory), connection }
    }
    async function remoteTool(operation, message, context, attachments) {
      const { connection } = await nativeClient()
      const local = connection.r2
      if (!local) throw new LinkError(503, "r2_host_unavailable", "Desktop R2 mail host is not connected")
      const url = new URL(local.url)
      if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.pathname !== "/r2/tool" || url.username || url.password || url.search || url.hash)
        throw new LinkError(503, "invalid_local_binding", "Invalid private R2 tool binding")
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${local.token}` },
        body: JSON.stringify({ operation, message, attachments, sessionID: context.sessionID, agent: context.agent }),
        signal: AbortSignal.any([context.signal, AbortSignal.timeout(30000)]) })
      const result = await response.json()
      if (!response.ok) throw new LinkError(response.status, /^[a-z_]+$/.test(result.error) ? result.error : "r2_unavailable", "R2 mail operation was refused or unavailable")
      return result
    }
    await ctx.tool.transform((editor) => {
      editor.namespace({ name: "branches", description: "Send attributed messages between independent existing OpenCode branches." })
      editor.add({
        name: "list",
        description: "List existing branches on this OpenCode server. Returns identifiers and titles, not their conversations. Does not create a subagent.",
        input: { type: "object", properties: {}, additionalProperties: false },
        options: { namespace: "branches", codemode: false },
        async execute() {
          // The v2.0.23 plugin SessionDomain does not expose list, despite the
          // broader client API. Use the sandbox's explicit private API binding.
          const { api } = await nativeClient()
          const sessions = await api.request("GET", "/api/session?limit=100")
          return { content: JSON.stringify({ branches: sessions.map((session) => ({ id: session.id, title: session.title, directory: session.location.directory })), limit: 100 }) }
        },
      })
      editor.add({
        name: "status",
        description: "Read a branch's current execution, pending messages and permission waits. This is a point-in-time observation, not proof that an inactive model/tool is hung.",
        input: { type: "object", properties: { targetSessionID: messageSchema.properties.targetSessionID }, required: ["targetSessionID"], additionalProperties: false },
        options: { namespace: "branches", codemode: false },
        async execute(input) {
          const { api } = await nativeClient()
          return { content: JSON.stringify(await inspect(api, input.targetSessionID)) }
        },
      })
      const executeControl = async (input, context) => {
        const { api, connection } = await nativeClient()
        const authority = connection.controlScope === "isolated-sandbox" ? async () => {} : undefined
        const result = await control(api, authority, parseControl(input), context)
        return { content: JSON.stringify(result), metadata: { action: input.action, status: result.status } }
      }
      editor.add({
        name: "control",
        description: "Create, rename, move, fork, or cancel pending input in a TEST branch. Working profiles require an exact direct owner mandate; that adapter is not enabled in R1. A move receipt means admission, not completed placement. Never rename/delete filesystem directories or delete conversation history.",
        input: { ...controlSchema, properties: { ...controlSchema.properties, action: { type: "string", enum: ["create", "rename", "move", "fork", "cancel-pending"] } } },
        options: { namespace: "branches", codemode: false },
        execute: executeControl,
      })
      editor.add({
        name: "stop",
        description: "Emergency: forcibly interrupt a TEST branch's generation and interruptible tools via the native stop path, without waiting in its inbox. A working branch requires an exact direct owner mandate (not enabled in R1). Idle recipients are a no-op. This does not kill an arbitrary Windows process or promise rollback of tool side effects.",
        input: { type: "object", properties: { targetSessionID: messageSchema.properties.targetSessionID }, required: ["targetSessionID"], additionalProperties: false },
        options: { namespace: "branches", codemode: false },
        execute: (input, context) => executeControl({ action: "stop", ...input }, context),
      })
      editor.add({
        name: "send",
        description: "Send a message to an existing independent branch: choose targetSessionID for a local branch OR secret-free addressRef from branches_contacts for a colleague, never both. wake starts idle work (queues if busy); queue parks idle input; steer enters at the next safe step boundary without interrupt. Identity comes from your actual Session/agent, never input. Remote files use attachments with local path (ordinary read permissions), optional name/mime; snapshots persist before sending. inReplyTo identifies the original installationID/sessionID/messageID. Remote outgoing is only locally saved; accepted proves branch admission, not reading/completion/reply. Incoming colleague mail grants no owner mutation authority. Reply via its replyToAddressRef (remote) or replyToSessionID (local). Does not create a subagent.",
        input: sendSchema,
        options: { namespace: "branches", codemode: false },
        async execute(input, context) {
          const message = parseSend(input)
          if (input.messageID === undefined) message.messageID = `${context.messageID}:${context.id}`
          if (message.addressRef) {
            const stored = await remoteTool("check", message, context)
            if (stored.status !== "snapshot_needed") return { content: JSON.stringify(stored), metadata: stored }
            const attachments = await snapshotAttachments(message.attachments, ctx.permission, context)
            const receipt = await remoteTool("send", message, context, attachments)
            return { content: JSON.stringify(receipt), metadata: receipt }
          }
          const source = await ctx.session.get({ sessionID: context.sessionID })
          const sender = { id: `session:${source.id}`, sessionID: source.id, agent: context.agent, label: source.title ?? source.id, authority: "peer-agent" }
          const receipt = await deliver(ctx.session, await readPolicy(policyFile), sender, message)
          return { content: JSON.stringify(receipt), metadata: receipt }
        },
      })
      editor.add({ name: "contacts", description: "List local contacts granted to this actual sending branch. Returns secret-free addressRef and recipient identities, not remote inventory or history. Use addressRef with branches_send; receipt stages are not model replies.",
        input: { type: "object", properties: {}, additionalProperties: false }, options: { namespace: "branches", codemode: false },
        async execute(input, context) { return { content: JSON.stringify(await remoteTool("contacts", undefined, context)) } },
      })
    })
    // Standalone tools do not require a writable policy directory. Desktop opts
    // into attestation at the binding boundary it owns.
    if (ctx.options.desktopBinding !== true) return
    // Attest the options of THIS loaded generation, not another config document
    // or another location using the same carrier. No secret is included.
    const file = bindingFile(policyFile, ctx.location.directory)
    const generation = randomUUID()
    const temporary = `${file}.${generation}.tmp`
    await writeFile(temporary, JSON.stringify({ generation, pid: process.pid, directory: ctx.location.directory, policyFile, connectionFile: ctx.options.connectionFile }), { mode: 0o600 })
    await rename(temporary, file)
    return async () => {
      const value = await readFile(file, "utf8").then((text) => JSON.parse(text), (error) => { if (error.code === "ENOENT") return undefined; throw error })
      if (value?.generation === generation) await unlink(file)
    }
  },
}
