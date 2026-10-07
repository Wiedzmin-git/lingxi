import { expect, test } from "bun:test"
import path from "node:path"

test("every Lingxi packaging channel requires an explicit local CLI before preparing resources", async () => {
  for (const channel of ["dev", "beta", "prod"]) {
    const env = { ...process.env, OPENCODE_CHANNEL: channel }
    delete env.OPENCODE_CLI_DIST

    const child = Bun.spawn([process.execPath, path.join(import.meta.dirname, "prebuild.ts")], {
      cwd: path.resolve(import.meta.dirname, ".."), env, stdout: "pipe", stderr: "pipe",
    })

    const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
    expect(code).not.toBe(0)
    expect(stderr).toContain("Lingxi desktop builds require OPENCODE_CLI_DIST from this checkout")
  }
})
