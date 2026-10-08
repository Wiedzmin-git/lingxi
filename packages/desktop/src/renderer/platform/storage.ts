import {
  createDraftStore,
  createNamespaceStorage,
  flushPersisted,
  awaitPersisted,
  type NamespaceStorage,
  type Platform,
} from "@opencode/app/desktop"
import type { ElectronAPI } from "../api-types"
import { onBeforeDispose } from "../ipc-client"

export function createDesktopStorage(api: ElectronAPI) {
  const namespaces = new Map<string, NamespaceStorage>()
  const driver = { items: api.storeItems, update: api.storeUpdate, clear: api.storeClear }

  const storage: NonNullable<Platform["storage"]> = (name = "default.dat") => {
    const cached = namespaces.get(name)

    if (cached) return cached

    const next = createNamespaceStorage(driver, name)
    namespaces.set(name, next)

    return next
  }

  // Dirty stores must serialize into their namespaces before the namespaces are sent; the app's
  // own pagehide listener registers after the IPC client's, so it cannot be relied on here.
  const flush = () => {
    flushPersisted()

    return Promise.all([...namespaces.values()].map((namespace) => namespace.flush()))
  }

  api.onStoreChanged((name, insert, remove, revision) => namespaces.get(name)?.accept(insert, remove, revision))
  // Durability boundaries: the window going away, and it leaving the foreground.
  onBeforeDispose(flush)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush()
  })

  let barrier: { id: string; inert: boolean } | undefined
  api.onPersistenceBarrier((id, phase) => {
    if (phase === "cancel") {
      if (barrier?.id !== id) return

      document.body.inert = barrier.inert
      barrier = undefined

      return
    }

    if (barrier) return

    barrier = { id, inert: document.body.inert }
    document.body.inert = true
    void awaitPersisted()
      .then(() => Promise.all([...namespaces.values()].map((namespace) => namespace.flush({ strict: true }))))
      .then(
        () => {
          if (barrier?.id === id) return api.persistenceBarrierReady(id, true)
        },
        () => {
          if (barrier?.id === id) return api.persistenceBarrierReady(id, false)
        },
      )
      .catch((error) => console.error("[persistence] exit acknowledgement failed", error))
  })

  return {
    storage,
    draftStore: createDraftStore({
      get: api.draftGet,
      set: api.draftSet,
      remove: api.draftDelete,
      putBlob: (blob) => blob.arrayBuffer().then(api.draftBlobPut),
      getBlob: (id) => api.draftBlobGet(id).then((data) => data && new Blob([data])),
    }),
  }
}
