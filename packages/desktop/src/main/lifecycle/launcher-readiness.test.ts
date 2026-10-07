import { expect, test } from "bun:test"
import { createHash, randomUUID } from "node:crypto"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { createServer } from "node:net"
import path from "node:path"
import os from "node:os"
import { pathToFileURL } from "node:url"

test("readiness waits for matching launcher acceptance and rejects changed profile bytes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lingxi-ready-"))
  try {
    for (const scenario of ["accepted", "wrong-ack", "changed-binding"]) {
      const id = randomUUID()
      const file = path.join(root, scenario + ".json")
      const text = JSON.stringify({
        format: 1,
        id,
        desktopUserData: root,
        dataHome: root,
        configHome: root,
        cacheHome: root,
        stateHome: root,
        database: path.join(root, "history.db"),
        serviceRegistration: path.join(root, "server.json"),
        serviceConfig: path.join(root, "config.json"),
        servicePort: 49102,
      })
      await writeFile(file, text)
      const pipe = "lingxi-ready-" + randomUUID().replaceAll("-", "")
      const attempt = randomUUID().replaceAll("-", "")
      const digest = createHash("sha256").update(text).digest("hex")
      const received: unknown[] = []
      const server = createServer((socket) => {
        socket.setEncoding("utf8")
        let input = ""
        socket.on("data", (chunk) => {
          input += chunk
          if (!input.includes("\n")) return
          const value = JSON.parse(input)
          received.push(value)
          socket.end(
            JSON.stringify({
              accepted: true,
              attemptId: scenario === "wrong-ack" ? "wrong" : attempt,
              bundleSha256: "b".repeat(64),
            }) + "\n",
          )
        })
      })
      await new Promise<void>((resolve) => server.listen("\\\\.\\pipe\\" + pipe, resolve))
      const module = pathToFileURL(path.join(import.meta.dir, "launcher-readiness.ts")).href
      const source = `const {reportLauncherReadiness,launcherReadinessAccepted}=await import(${JSON.stringify(module)}); if(launcherReadinessAccepted())throw Error("premature acceptance"); ${scenario === "changed-binding" ? `await Bun.write(${JSON.stringify(file)}, ${JSON.stringify(text + " ")});` : ""} await reportLauncherReadiness("fixture-v1"); if(!launcherReadinessAccepted())throw Error("acceptance not retained"); await reportLauncherReadiness("fixture-v1"); console.log("accepted")`
      const child = Bun.spawn([process.execPath, "-e", source], {
        env: {
          ...process.env,
          LINGXI_PROFILE_BINDING: file,
          LINGXI_PROFILE_ID: id,
          LINGXI_PROFILE_DIGEST: digest,
          LINGXI_READINESS_PIPE: pipe,
          LINGXI_LAUNCH_ATTEMPT: attempt,
          LINGXI_BUNDLE_DIGEST: "b".repeat(64),
        },
        stdout: "pipe",
        stderr: "pipe",
      })
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      await new Promise<void>((resolve) => server.close(() => resolve()))
      if (scenario !== "accepted") {
        expect(code).not.toBe(0)
        expect(stdout).not.toContain("accepted")
        continue
      }
      expect(code, stderr).toBe(0)
      expect(received).toEqual([
        {
          format: 1,
          attemptId: attempt,
          bundleSha256: "b".repeat(64),
          profileId: id,
          bindingSha256: digest,
          processId: child.pid,
          backendVersion: "fixture-v1",
          storage: true,
          renderer: true,
          server: true,
          sessionLink: true,
        },
      ])
      expect(stdout).toContain("accepted")
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 15_000)
