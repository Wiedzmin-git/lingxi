import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { createConnection } from "node:net"
import { profileBinding, profileEnvironment } from "@opencode/util/profile-binding"
import { Schema } from "effect"

let pending: Promise<void> | undefined
let accepted = false

export function launcherReadinessAccepted() {
  return accepted
}

export function reportLauncherReadiness(backendVersion: string) {
  if (!process.env.LINGXI_READINESS_PIPE) return Promise.resolve()
  if (pending) return pending
  pending = report(backendVersion)
    .then(() => {
      accepted = true
    })
    .catch((error) => {
      pending = undefined
      throw error
    })
  return pending
}

async function report(backendVersion: string) {
  const pipe = process.env.LINGXI_READINESS_PIPE
  const attempt = process.env.LINGXI_LAUNCH_ATTEMPT
  const bundle = process.env.LINGXI_BUNDLE_DIGEST
  const digest = process.env.LINGXI_PROFILE_DIGEST
  if (
    !profileBinding ||
    !profileEnvironment ||
    !pipe ||
    !/^lingxi-ready-[a-f0-9]{32}$/.test(pipe) ||
    !attempt ||
    !/^[a-f0-9]{32}$/.test(attempt) ||
    !bundle ||
    !/^[a-f0-9]{64}$/.test(bundle) ||
    !digest ||
    !/^[a-f0-9]{64}$/.test(digest)
  )
    throw new Error("Incomplete launcher readiness coordinates")
  if (
    createHash("sha256")
      .update(await readFile(profileEnvironment.LINGXI_PROFILE_BINDING))
      .digest("hex") !== digest
  )
    throw new Error("Profile descriptor changed during Desktop startup")
  const message =
    JSON.stringify({
      format: 1,
      attemptId: attempt,
      bundleSha256: bundle,
      profileId: profileBinding.id,
      bindingSha256: digest,
      processId: process.pid,
      backendVersion,
      storage: true,
      renderer: true,
      server: true,
      sessionLink: true,
    }) + "\n"
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection("\\\\.\\pipe\\" + pipe)
    let reply = ""
    socket.setTimeout(5_000, () => socket.destroy(new Error("Launcher readiness pipe timed out")))
    socket.once("error", reject)
    socket.once("end", () => reject(new Error("Launcher closed before readiness acceptance")))
    socket.setEncoding("utf8")
    socket.on("data", (chunk: string) => {
      reply += chunk
      if (reply.length > 4096) return socket.destroy(new Error("Invalid launcher acceptance size"))
      if (!reply.includes("\n")) return
      const accepted = Schema.decodeUnknownOption(
        Schema.fromJsonString(
          Schema.Struct({
            accepted: Schema.Literal(true),
            attemptId: Schema.Literal(attempt),
            bundleSha256: Schema.Literal(bundle),
          }),
        ),
      )(reply.trim())
      if (accepted._tag === "None") return socket.destroy(new Error("Launcher acceptance does not match startup"))
      resolve()
      socket.end()
    })
    socket.once("connect", () => socket.write(message))
  })
}
