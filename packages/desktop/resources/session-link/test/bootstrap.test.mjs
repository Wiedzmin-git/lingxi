import assert from "node:assert/strict"
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { fileURLToPath } from "node:url"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "node:test"
import { prepareDesktopLink } from "../src/desktop-host.mjs"
import { tokenHash } from "../src/policy.mjs"

test("fresh profiles have no external senders; existing owner policy survives bootstrap byte-for-byte", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lingxi-bootstrap-"))
  try {
    const first = await prepareDesktopLink(root)
    assert.deepEqual(JSON.parse(await readFile(path.join(root, "policy.json"), "utf8")), {
      wake: { allow: ["session:*"], deny: [] }, senders: [],
    })
    assert.deepEqual(await readdir(path.join(root, ".private")), [])
    await first.close()
    const retained = JSON.stringify({ wake: { allow: ["external:fixture"], deny: ["session:ses_denied"] },
      senders: [{ id: "fixture", label: "Owner-configured fixture", authority: "peer-agent", tokenHash: tokenHash("test-only-token") }] }, null, 4)
    await writeFile(path.join(root, "policy.json"), retained)
    const second = await prepareDesktopLink(root, JSON.stringify({ plugins: [{ package: "fixture-existing-plugin" }] }))
    assert.equal(await readFile(path.join(root, "policy.json"), "utf8"), retained)
    assert.equal(JSON.parse(second.environment.OPENCODE_CONFIG_CONTENT).plugins[0].package, "fixture-existing-plugin")
    await second.close()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

for (const variant of ["identical", "desktop-only", "superseded", "changed-runtime", "missing-runtime"]) {
  test(`retained backend carrier: ${variant}`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lingxi-carrier-"))
    const candidate = path.join(root, "previous-package")
    const current = fileURLToPath(new URL("..", import.meta.url))
    const profile = path.join(root, "profile")
    const policyFile = path.join(profile, "policy.json")
    const connectionFile = path.join(profile, ".private", "connection.json")
    const server = createServer((req, res) => {
      res.setHeader("content-type", "application/json")
      const body = req.url === "/api/info" ? { pid: process.pid, version: "same-backend" }
        : req.url === "/api/config" ? [{ info: { plugins: (variant === "superseded" ? [current, candidate] : [candidate]).map((packagePath) => ({ package: packagePath, options: { policyFile, connectionFile } })) } }]
        : req.url === "/api/plugin" ? { data: [{ id: "session-link", state: { status: "active" }, source: { type: "local", path: path.join(candidate, "index.js") } }] }
        : { data: [] }
      res.end(JSON.stringify(body))
    })
    let host
    try {
      await cp(current, candidate, { recursive: true })
      if (variant === "desktop-only") await writeFile(path.join(candidate, "src/desktop-host.mjs"), "old Desktop bootstrap adapter")
      if (variant === "changed-runtime") await writeFile(path.join(candidate, "src/policy.mjs"), "different backend runtime")
      if (variant === "missing-runtime") await rm(path.join(candidate, "src/policy.mjs"))
      host = await prepareDesktopLink(profile)
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
      const result = await host.connect({ url: `http://127.0.0.1:${server.address().port}`, password: "fixture", directory: root })
      assert.equal(result.status, "unavailable")
      // Matching bytes advance to the independent generation-attestation gate;
      // changed or missing runtime bytes must fail before that gate.
      assert.equal(result.reason, ["identical", "desktop-only", "superseded"].includes(variant)
        ? "session-link-active-binding-mismatch" : "compatible-service-missing-session-link-binding")
    } finally {
      await host?.close()
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
      await rm(root, { recursive: true, force: true })
    }
  })
}
