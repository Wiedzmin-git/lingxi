export * as DesktopStorage from "./index"

import { app, BrowserWindow } from "electron"
import { Context, Effect, Layer, Path } from "effect"
import { marks } from "../lifecycle/marks"
import { openDatabase } from "./database"
import { setStorageSnapshotProvider } from "./snapshot"
import { createDraftStore } from "./drafts"
import { importLegacyStores } from "./legacy"
import { createStateStore } from "./state"
import { readEnableState } from "../extension/enable-state"

export type Interface = ReturnType<typeof make>

export class Service extends Context.Service<Service, Interface>()("opencode/desktop/DesktopStorage") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const path = yield* Path.Path
    const runFork = Effect.runForkWith(yield* Effect.context())
    const userData = app.getPath("userData")

    const storage = make(path.join(userData, "drafts.sqlite"), (error) =>
      runFork(Effect.logError("storage flush failed", { error })),
    )

    yield* importLegacyStores(storage.db, userData).pipe(
      Effect.tap((result) =>
        result.removed.length === 0
          ? Effect.void
          : Effect.logInfo("imported legacy store files", { imported: result.imported, files: result.removed }),
      ),
      Effect.catch((error) => Effect.logWarning("failed to import legacy store files", { error })),
    )
    // Controlled quit is gated by ApplicationLifecycle. The OS session-end
    // event cannot be vetoed here; storage's reporter records any failure.
    const sessionEnd = () => {
      try {
        storage.flush()
      } catch {}
    }
    const wire = (_event: Electron.Event | undefined, win: BrowserWindow) => win.on("session-end", sessionEnd)
    app.on("browser-window-created", wire)
    BrowserWindow.getAllWindows().forEach((win) => wire(undefined, win))
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        app.off("browser-window-created", wire)
        BrowserWindow.getAllWindows().forEach((win) => win.off("session-end", sessionEnd))
        storage.close()
      }),
    )
    setStorageSnapshotProvider((names) => ({
      storage: Object.fromEntries(names.map((name) => [name, storage.state.items(name)])),
      extensions: readEnableState(storage.db.$client),
    }))
    marks.storage = Date.now()

    return Service.of(storage)
  }),
)

// The file keeps its historical name; renaming it would mean moving the drafts it already holds.
// SAFETY: this observer only reports caught write failures; it never interprets them as stored values.
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- see SAFETY above
export function make(filename: string, onError?: (error: unknown) => void) {
  const database = openDatabase(filename)
  const state = createStateStore(database.db, { onError })
  const drafts = createDraftStore(database.db, { onError })

  return {
    db: database.db,
    state,
    drafts,
    flush() {
      state.flush()
      drafts.flush()
    },
    close() {
      // Keep both stores writable if either durability barrier fails.
      state.flush()
      drafts.flush()
      state.close()
      drafts.close()
      database.close()
    },
  }
}
