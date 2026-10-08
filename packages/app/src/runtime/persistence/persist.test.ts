import { describe, expect, test } from "bun:test"
import type { PersistenceSyncAPI, PersistenceSyncCallback, SyncStorage } from "@solid-primitives/storage"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { awaitPersisted, flushPersisted, persistStore, preparePersisted } from "./persist"

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type State = { count: number; label: string }

function setup(input: {
  initial?: string | null
  delay?: number
  sync?: PersistenceSyncAPI
  write?: (value: State, serialized: string) => Promise<void>
  serialize?: (value: State) => string
}) {
  const writes: string[] = []

  return createRoot((dispose) => {
    const [store, setStore] = createStore<State>({ count: 0, label: "" })

    const persist = persistStore({
      store,
      setStore,
      name: "state",
      storage: {
        getItem: () => input.initial ?? null,
        setItem: (_key: string, value: string) => {
          writes.push(value)
        },
        removeItem: () => {},
      } satisfies SyncStorage,
      serialize: input.serialize ?? JSON.stringify,
      deserialize: JSON.parse,
      sync: input.sync,
      delay: input.delay ?? 10,
      write: input.write,
    })

    return { store, set: persist.setStore, persist, writes, dispose }
  })
}

describe("persistStore", () => {
  test("exit barrier waits for async document writes and retries a failed save", async () => {
    const upload = Promise.withResolvers<void>()
    const writes: string[] = []
    let fail = false

    const value = setup({
      delay: 10_000,
      write: async (_value, serialized) => {
        await upload.promise

        if (fail) throw new Error("blob upload failed")

        writes.push(serialized)
      },
    })

    const preparation = Promise.withResolvers<void>()
    const preparing = preparePersisted(preparation.promise.then(() => value.set("label", "last keystroke")))
    let saved = false

    const barrier = awaitPersisted().then(() => {
      saved = true
    })

    await Promise.resolve()
    expect(saved).toBe(false)
    expect(writes).toEqual([])
    preparation.resolve()
    await preparing
    expect(saved).toBe(false)
    upload.resolve()
    await barrier
    expect(writes).toEqual([JSON.stringify({ count: 0, label: "last keystroke" })])
    fail = true
    value.set("label", "unsaved attachment")
    await expect(awaitPersisted()).rejects.toThrow("Renderer persistence failed")
    fail = false
    await awaitPersisted()
    expect(writes.at(-1)).toBe(JSON.stringify({ count: 0, label: "unsaved attachment" }))
    value.dispose()
  })

  test("a failed serializer continues blocking exit until the same dirty state is saved", async () => {
    let fail = true

    const value = setup({ serialize: (state) => {
      if (fail) throw new Error("serialization failed")

      return JSON.stringify(state)
    } })

    value.set("label", "still pending")
    await expect(awaitPersisted()).rejects.toThrow("serialization failed")
    await expect(awaitPersisted()).rejects.toThrow("serialization failed")
    expect(value.writes).toEqual([])
    fail = false
    await awaitPersisted()
    expect(value.writes).toEqual([JSON.stringify({ count: 0, label: "still pending" })])
    value.dispose()
  })

  test("marks the store dirty on set and writes once after the delay", async () => {
    const value = setup({})
    value.set("count", 1)
    value.set("count", 2)
    value.set("label", "a")
    expect(value.store.count).toBe(2)
    expect(value.writes).toEqual([])
    await wait(30)
    expect(value.writes).toEqual([JSON.stringify({ count: 2, label: "a" })])
    value.dispose()
  })

  test("skips the write when the serialized value did not change", () => {
    const value = setup({ delay: 10_000 })
    value.set("count", 1)
    value.persist.flush()
    value.set("count", 1)
    value.persist.flush()
    expect(value.writes).toHaveLength(1)
    value.dispose()
  })

  test("hydrates synchronously from sync storage without writing back", () => {
    const value = setup({ initial: JSON.stringify({ count: 5, label: "saved" }), delay: 10_000 })
    expect(value.store).toEqual({ count: 5, label: "saved" })
    value.persist.flush()
    expect(value.writes).toEqual([])
    value.dispose()
  })

  test("applies another window's value when clean and ignores it while dirty", () => {
    const listeners: PersistenceSyncCallback[] = []
    const sent: string[] = []

    const value = setup({
      delay: 10_000,
      sync: [(subscriber) => listeners.push(subscriber), (_key, next) => sent.push(String(next))],
    })

    listeners[0]!({ key: "state", newValue: JSON.stringify({ count: 3, label: "remote" }), timeStamp: 0 })
    expect(value.store).toEqual({ count: 3, label: "remote" })
    value.set("label", "local")
    listeners[0]!({ key: "state", newValue: JSON.stringify({ count: 4, label: "remote-2" }), timeStamp: 0 })
    expect(value.store).toEqual({ count: 3, label: "local" })
    value.persist.flush()
    expect(sent).toEqual([JSON.stringify({ count: 3, label: "local" })])
    value.dispose()
  })

  test("a remote value arriving during a no-op local set is adopted when the save finds no change", () => {
    const listeners: PersistenceSyncCallback[] = []
    const sent: string[] = []

    const value = setup({
      delay: 10_000,
      sync: [(subscriber) => listeners.push(subscriber), (_key, next) => sent.push(String(next))],
    })

    value.set("count", 1)
    value.persist.flush()
    // Setting the same value again marks the store dirty without changing it.
    value.set("count", 1)
    listeners[0]!({ key: "state", newValue: JSON.stringify({ count: 1, label: "remote" }), timeStamp: 0 })
    expect(value.store.label).toBe("")
    value.persist.flush()
    expect(value.store).toEqual({ count: 1, label: "remote" })
    expect(value.writes).toHaveLength(1)
    expect(sent).toHaveLength(1)
    // A later save must not consider the adopted value a local change.
    value.set("count", 1)
    value.persist.flush()
    expect(value.writes).toHaveLength(1)
    value.dispose()
  })

  test("a remote revert to the saved value during a no-op local set clears an earlier held change", () => {
    const listeners: PersistenceSyncCallback[] = []
    const value = setup({ delay: 10_000, sync: [(subscriber) => listeners.push(subscriber), () => {}] })
    value.set("label", "saved")
    value.persist.flush()
    value.set("label", "saved")
    listeners[0]!({ key: "state", newValue: JSON.stringify({ count: 0, label: "changed" }), timeStamp: 0 })
    listeners[0]!({ key: "state", newValue: JSON.stringify({ count: 0, label: "saved" }), timeStamp: 0 })
    value.persist.flush()
    expect(value.store).toEqual({ count: 0, label: "saved" })
    expect(value.writes).toHaveLength(1)
    value.dispose()
  })

  test("a remote value arriving during a real local change is dropped in favour of the local one", () => {
    const listeners: PersistenceSyncCallback[] = []
    const value = setup({ delay: 10_000, sync: [(subscriber) => listeners.push(subscriber), () => {}] })
    value.set("count", 1)
    listeners[0]!({ key: "state", newValue: JSON.stringify({ count: 9, label: "remote" }), timeStamp: 0 })
    value.persist.flush()
    expect(value.store).toEqual({ count: 1, label: "" })
    expect(value.writes).toEqual([JSON.stringify({ count: 1, label: "" })])
    value.dispose()
  })

  test("disposing the owner and flushPersisted both save pending changes", () => {
    const first = setup({ delay: 10_000 })
    first.set("count", 1)
    first.dispose()
    expect(first.writes).toHaveLength(1)

    const second = setup({ delay: 10_000 })
    second.set("count", 2)
    flushPersisted()
    expect(second.writes).toEqual([JSON.stringify({ count: 2, label: "" })])
    second.dispose()
    expect(second.writes).toHaveLength(1)
  })
})
