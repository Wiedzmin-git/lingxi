import { expect, test } from "bun:test"
import path from "node:path"

test("packaged identity follows metadata and isolated Desktop never registers the OS protocol", async () => {
  for (const scenario of ["upstream", "lingxi", "bound", "disabled"]) {
    const child = Bun.spawn(
      [process.execPath, path.join(import.meta.dir, "environment.fixture.test.ts"), "--environment-fixture", scenario],
      {
        env: {
          ...process.env,
          OPENCODE_CHANNEL: "dev",
          OPENCODE_DESKTOP_PROFILE_ROOT: "",
          OPENCODE_DESKTOP_DISABLE_PROTOCOL_REGISTRATION: scenario === "disabled" ? "1" : "0",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(code, stderr).toBe(0)
    expect(JSON.parse(stdout)).toEqual({
      id: scenario === "lingxi" ? "app.lingxi.desktop" : "ai.opencode.desktop.dev",
      name: scenario === "lingxi" ? "Lingxi · 靈犀" : "OpenCode Dev",
      calls: scenario === "upstream" ? ["os:opencode", "renderer"] : ["renderer"],
    })
  }
})
