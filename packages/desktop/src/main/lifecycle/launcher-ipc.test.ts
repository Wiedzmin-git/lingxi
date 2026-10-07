import { expect, test } from "bun:test"
import path from "node:path"

test("raw startup readiness ingress requires sender, matching backend, Session Link and durable storage", async () => {
  const child = Bun.spawn(
    [process.execPath, path.join(import.meta.dir, "launcher-ipc.fixture.test.ts"), "--launcher-ipc-fixture"],
    { stdout: "pipe", stderr: "pipe" },
  )
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  expect(code, stdout + stderr).toBe(0)
  expect(stdout).toContain("raw startup IPC: 8 scenarios passed")
})
