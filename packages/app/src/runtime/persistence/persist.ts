import type { AsyncStorage, PersistenceSyncAPI, SyncStorage } from "@solid-primitives/storage"
import { getOwner, onCleanup, untrack } from "solid-js"
import { reconcile, type SetStoreFunction, type Store } from "solid-js/store"

export const persistSaveDelay = 100

const pending = new Set<() => void>()

const writing = new Set<Promise<void>>()

const failed = new Map<() => void, unknown>()

const preparing = new Set<Promise<unknown>>()

/** Track async work that will still insert data into a persisted store, such as an attachment upload. */
export function preparePersisted<T>(work: Promise<T>): Promise<T> {
  preparing.add(work)
  void work.then(() => preparing.delete(work), () => preparing.delete(work))

  return work
}

/** Serialize and write every store with unsaved changes now. */
export function flushPersisted() {
  for (const save of [...pending]) save()
}

/** Await renderer-owned writes, including asynchronous draft/blob encoding. */
export async function awaitPersisted() {
  do {
    while (preparing.size) await Promise.all([...preparing])

    flushPersisted()

    while (writing.size) await Promise.all([...writing])

    if (failed.size) throw new Error("Renderer persistence failed", { cause: [...failed.values()][0] })
  } while (pending.size || preparing.size)
}

// Covers synchronous web storage. Desktop registers its own pagehide handling earlier than this
// module loads, so its shutdown path calls flushPersisted() itself before flushing namespaces.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushPersisted()
  })
  window.addEventListener("pagehide", flushPersisted)
}

// A store whose serialized form is written to storage on a schedule instead of on every setter
// call. The setter only marks the store dirty; serialization happens once per save window, once
// per owner cleanup, and when the page hides. Mirrors VS Code's Memento.
export function persistStore<T extends object>(input: {
  store: Store<T>
  setStore: SetStoreFunction<T>
  name: string
  storage: SyncStorage | AsyncStorage
  serialize: (value: T) => string
  deserialize: (raw: string) => T
  sync?: PersistenceSyncAPI
  delay?: number
  /** Replaces `storage.setItem` for stores whose storage can take the value itself. */
  write?: (value: T, serialized: string) => void | Promise<void>
}) {
  const delay = input.delay ?? persistSaveDelay
  let dirty = false
  let touched = false
  let last: string | undefined
  // The newest value another window wrote while this store was dirty; applied at save time if the
  // local setter calls turned out not to change anything.
  let remote: string | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let revision = 0

  const save = () => {
    clearTimeout(timer)
    timer = undefined
    pending.delete(save)

    if (!dirty) return

    const current = revision + 1

    try {
      dirty = false
      const held = remote
      remote = undefined
      const next = untrack(() => input.serialize(input.store))

      if (next === last) {
        if (held !== undefined && held !== last) hydrate(held)

        return
      }

      last = next
      revision = current
      input.sync?.[1](input.name, next)
      const result = input.write ? input.write(input.store, next) : input.storage.setItem(input.name, next)

      const write = Promise.resolve(result)
        .then(
          () => {
            if (revision === current) failed.delete(save)
          },
          (error) => {
            if (revision !== current) return

            failed.set(save, error)
            last = undefined
            dirty = true
            pending.add(save)
            console.error(`[persistence] write failed for ${input.name}`, error)
          },
        )
        .finally(() => writing.delete(write))

      writing.add(write)
    } catch (error) {
      revision = current
      failed.set(save, error)
      last = undefined
      dirty = true
      pending.add(save)

      throw error
    }
  }

  // SAFETY: called only by the SetStoreFunction<T> wrapper below with its unchanged arguments.
  // Solid's recursive overloads exceed TypeScript's comparison depth when forwarded generically.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions
  const apply = input.setStore as unknown as (...values: unknown[]) => void

  // SAFETY: preserves every Solid setter overload by forwarding to the original setter before marking dirty.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions
  const setStore = ((...values: unknown[]) => {
    apply(...values)
    dirty = true
    touched = true
    pending.add(save)
    timer ??= setTimeout(save, delay)
  }) as unknown as SetStoreFunction<T>

  const hydrate = (raw: string) => {
    last = raw
    input.setStore(reconcile(input.deserialize(raw)))
  }

  const init = input.storage.getItem(input.name)

  // A value the user already changed is newer than whatever storage held.
  if (init instanceof Promise) void init.then((raw) => raw && !touched && hydrate(raw))
  else if (init) hydrate(init)

  input.sync?.[0]((data) => {
    if (data.key !== input.name || (data.url ?? location.href) !== location.href) return

    if (!data.newValue) return

    // A real unsaved local change wins over another window's write, as in VS Code's storage
    // service; whether the change is real is only known when the store is serialized. Every
    // remote value replaces the held one, including a revert to `last`, so the save sees the
    // other window's final state rather than an intermediate one.
    if (dirty) {
      remote = data.newValue

      return
    }

    if (data.newValue === last) return

    hydrate(data.newValue)
  })

  if (getOwner()) onCleanup(save)

  return { setStore, init, flush: save }
}
