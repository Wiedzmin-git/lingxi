import { expect, test } from "bun:test"
import path from "node:path"
import { pathToFileURL } from "node:url"

test("Lingxi channels package one identity without an upstream update feed or protocol takeover", async () => {
  const module = pathToFileURL(path.join(import.meta.dir, "electron-builder.lingxi.config.ts")).href
  for (const channel of ["dev", "beta", "prod"]) {
    const child = Bun.spawn(
      [
        process.execPath,
        "-e",
        `const {default:c}=await import(${JSON.stringify(module)});console.log(JSON.stringify({appId:c.appId,name:c.productName,executable:c.win.executableName,version:c.extraMetadata.version,publish:c.publish,protocols:c.protocols}))`,
      ],
      {
        env: { ...process.env, OPENCODE_CHANNEL: channel, LINGXI_DESKTOP_VERSION: "2.0.23-lingxi.dev.1" },
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
      appId: "app.lingxi.desktop",
      name: "Lingxi · 靈犀",
      executable: "Lingxi",
      version: "2.0.23-lingxi.dev.1",
      publish: [],
      protocols: [],
    })
  }
})
