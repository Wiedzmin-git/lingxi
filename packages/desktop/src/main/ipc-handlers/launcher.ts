import { BrowserWindow } from "electron"
import { Effect, Schema } from "effect"
import { LauncherRpcs } from "../../shared/ipc-rpc/launcher"
import { IpcPortHandoff } from "../ipc-transport"
import { DesktopStorage } from "../storage"
import { BackgroundService } from "../service/background-service"
import { DesktopCli } from "../service/desktop-cli"
import { SidecarCredentials } from "../service/sidecar-credentials"
import { sessionLinkReadyFor } from "../service/session-link"
import { launcherReadinessAccepted, reportLauncherReadiness } from "../lifecycle/launcher-readiness"
import { sender } from "./context"

export const launcherHandlers = LauncherRpcs.toLayer(
  Effect.gen(function* () {
    const handoff = yield* IpcPortHandoff
    const background = yield* BackgroundService.Service
    const desktopCli = yield* DesktopCli.Service
    const storage = yield* DesktopStorage.Service
    return LauncherRpcs.of({
      AppReportStartupReady: (_payload, context) =>
        Effect.gen(function* () {
          if (!process.env.LINGXI_READINESS_PIPE) return
          const contents = sender(handoff, context)
          const window = BrowserWindow.fromWebContents(contents)
          if (!window || window.isDestroyed() || contents.isDestroyed() || window.webContents !== contents)
            throw new Error("Invalid startup readiness sender")
          // Acceptance belongs to this main process; a renderer reload must not
          // repeat startup admission against temporarily unavailable dependencies.
          if (launcherReadinessAccepted()) return
          const connection = yield* background.connection
          const cli = yield* desktopCli.resolve
          const response = yield* Effect.tryPromise(() =>
            fetch(new URL("/api/info", connection.url), {
              headers: { authorization: SidecarCredentials.authorization(connection, connection.url)! },
              signal: AbortSignal.timeout(5_000),
            }),
          )
          if (!response.ok) throw new Error("Backend readiness probe failed")
          const info = yield* Effect.tryPromise(() => response.json())
          const health = Schema.decodeUnknownSync(Schema.Struct({ version: Schema.String }))(info)
          if (health.version !== cli.version || !sessionLinkReadyFor(connection.url) || contents.isDestroyed())
            throw new Error("Startup dependencies are not ready")
          storage.flush()
          yield* Effect.promise(() => reportLauncherReadiness(health.version))
        }).pipe(Effect.orDie),
    })
  }),
)
