import { app, clipboard } from "electron"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { Effect } from "effect"
import { DesktopPaths } from "../paths"
import type { SidecarCredentials } from "./sidecar-credentials"
import { Schema } from "effect"
import { SessionLinkRequest, SessionLinkResult } from "@opencode/app/session-link"

type Host = {
  environment: Record<string, string>
  connect: (
    connection: SidecarCredentials.Data & { directory: string },
  ) => Promise<{ status: "ready"; gateway: string } | { status: "unavailable"; reason: string }>
  close: () => Promise<void>
  // SAFETY: This is the raw bundled MJS boundary. manageSessionLink supplies a
  // decoded SessionLinkRequest and decodes every value returned to the renderer.
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type, anti-slop/no-unknown-returns
  manage: (operation: string, input: Record<string, unknown>) => Promise<unknown>
}

let host: Host | undefined

let boundServer: string | undefined

export function sessionLinkReadyFor(server: string) {
  return boundServer === server
}

export const prepareSessionLink = Effect.fn("Desktop.prepareSessionLink")(function* () {
  if (host) return host.environment
  const paths = yield* DesktopPaths.resolve
  const root = app.isPackaged ? process.resourcesPath : paths.developmentResourcesRoot

  const module = yield* Effect.promise(
    () => import(pathToFileURL(path.join(root, "session-link", "src", "desktop-host.mjs")).href),
  )

  // SAFETY: The import resolves only our bundled desktop-host.mjs, whose exported
  // prepareDesktopLink owns this Host shape; packaged bytes are inventoried.
  const prepare = module.prepareDesktopLink as (root: string, config?: string) => Promise<Host>
  host = yield* Effect.tryPromise(() =>
    prepare(path.join(app.getPath("userData"), "session-link"), process.env.OPENCODE_CONFIG_CONTENT),
  )
  app.once("will-quit", () => void host?.close().catch(() => undefined))

  return host!.environment
})

export const connectSessionLink = Effect.fn("Desktop.connectSessionLink")(function* (
  connection: SidecarCredentials.Data,
) {
  if (!host) throw new Error("Session Link was not prepared")
  const ready = yield* Effect.tryPromise(() => host!.connect({ ...connection, directory: app.getPath("home") }))

  if (ready.status === "unavailable") {
    boundServer = undefined
    yield* Effect.logWarning("session link unavailable; existing service was not changed", ready)

    return ready
  }

  boundServer = connection.url
  yield* Effect.logInfo("session link gateway ready", ready)

  return ready
})

export async function manageSessionLink(request: SessionLinkRequest): Promise<SessionLinkResult> {
  if (!host || !boundServer) return { error: "r2_host_unavailable" }

  if (request.server !== "sidecar" && request.server.replace(/\/+$/, "") !== boundServer.replace(/\/+$/, ""))
    return { error: "different_server" }

  try {
    const result = await host.manage(request.operation, { ...request })

    if (request.operation === "issue-address" || request.operation === "copy-address") {
      const value = Schema.decodeUnknownSync(Schema.Struct({ invitation: Schema.String }))(result)
      // Capability secret goes directly to the owner clipboard, not renderer/model history.
      clipboard.writeText(value.invitation)

      return { ok: true, copied: true }
    }

    if (["status", "contacts", "mail"].includes(request.operation))
      return Schema.decodeUnknownSync(SessionLinkResult)(result)

    return { ok: true }
  } catch (error) {
    const code =
      // SAFETY: The complete condition validates the external error's code against
      // the lowercase identifier grammar before any value reaches the renderer.
      // oxlint-disable-next-line anti-slop/no-runtime-typeof
      error instanceof Error && "code" in error && typeof error.code === "string" && /^[a-z_]+$/.test(error.code)
        ? error.code
        : "r2_unavailable"

    return { error: code }
  }
}
