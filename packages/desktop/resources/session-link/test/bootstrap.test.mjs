import assert from "node:assert/strict"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
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
