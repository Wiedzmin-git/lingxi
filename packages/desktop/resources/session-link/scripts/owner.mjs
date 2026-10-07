import { readFile } from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"
import { parseOwnerInput } from "../src/r2-owner.mjs"

// Owner-side command only. Invoke under a direct local-owner mandate and ordinary
// shell/file permissions. Incoming colleague mail is not such a mandate.
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: Object.fromEntries([
    "root", "session", "peer", "bind", "publish-host", "port", "wake", "file", "label", "config-file",
  ].map((name) => [name, { type: "string" }])) })
  if (positionals.length !== 1 || !values.root) throw new Error("invalid_owner_command")
  if (values.wake !== undefined && !["true", "false"].includes(values.wake)) throw new Error("invalid_wake")
  const operation = positionals[0]
  const input = parseOwnerInput(Object.fromEntries(Object.entries({ operation, sessionID: values.session,
    peer: values.peer, bind: values.bind, publishHost: values["publish-host"],
    port: values.port === undefined ? undefined : Number(values.port), wake: values.wake === undefined ? undefined : values.wake === "true",
    file: values.file ? path.resolve(values.file) : undefined, label: values.label,
    config: values["config-file"] ? JSON.parse(await readFile(values["config-file"], "utf8")) : undefined,
  }).filter(([, value]) => value !== undefined)))
  const connection = JSON.parse(await readFile(path.join(path.resolve(values.root), ".private", "r2-owner.json"), "utf8")
    .catch(() => { throw new Error("owner_host_unavailable") }))
  const url = new URL(connection.url)
  if (connection.protocolVersion !== 1 || url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.pathname !== "/r2/owner" || url.username || url.password || url.search || url.hash || typeof connection.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(connection.token))
    throw new Error("invalid_owner_connection")
  const response = await fetch(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(30000),
    headers: { authorization: `Bearer ${connection.token}`, "content-type": "application/json" }, body: JSON.stringify(input) })
    .catch(() => { throw new Error("owner_host_unavailable") })
  const result = await response.json()
  if (!response.ok) throw new Error(typeof result.error === "string" && /^[a-z_]+$/.test(result.error) ? result.error : "owner_operation_failed")
  // Server returns only metadata/addressRef; private invitation bytes never cross
  // this response boundary. No credential or arbitrary peer body is printed.
  console.log(JSON.stringify(result))
} catch (error) {
  const code = typeof error.code === "string" && /^[a-z_]+$/.test(error.code) ? error.code :
    typeof error.message === "string" && /^[a-z_]+$/.test(error.message) ? error.message : "invalid_owner_command"
  console.log(JSON.stringify({ error: code }))
  process.exitCode = 1
}
