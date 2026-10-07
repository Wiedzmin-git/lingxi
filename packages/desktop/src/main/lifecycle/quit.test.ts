import { expect, test } from "bun:test"
import path from "node:path"

test("production quit handlers gate persistence, retry and failed restart handoff", async () => {
  const child = Bun.spawn(
    [process.execPath, path.join(import.meta.dirname, "quit.fixture.test.ts"), "--quit-fixture"],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  expect(code, stdout + stderr).toBe(0)
  expect(stdout).toContain("production quit handlers: 6 scenarios passed")
})
