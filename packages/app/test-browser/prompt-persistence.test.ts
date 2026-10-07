import { describe, expect, test } from "bun:test"
import type { AsyncStorage } from "@solid-primitives/storage"
import { createEffect, createRoot } from "solid-js"
import { Schema } from "effect"
import { base64Encode } from "@opencode/util/encode"
import { ComposerStore } from "@/composer/schema"
import type { Platform } from "@/runtime/platform/platform"
import { createComposerReady, createComposerState } from "@/composer/state"
import { ServerScope } from "@/runtime/server/scope"
import { ServerConnection } from "@/runtime/server/registry"
import { createDraftStore, resolveBlobUrl } from "@/runtime/persistence/drafts"
import { flushPersisted } from "@/runtime/persistence/persist"
import { Persist, persisted } from "@/runtime/persistence/storage"

let read: ((value: string | null) => void) | undefined

const storage: AsyncStorage = {
  getItem: () => new Promise((resolve) => (read = resolve)),
  setItem: async () => undefined,
  removeItem: async () => undefined,
  clear: async () => undefined,
  key: async () => null,
  getLength: async () => 0,
  length: Promise.resolve(0),
}

const platform: Platform = {
  platform: "web",
  openExternal: () => undefined,
  restart: async () => undefined,
  notify: async () => undefined,
  draftStore: {
    ...storage,
    putBlob: async () => {
      throw new Error("putBlob is not used by this test")
    },
  },
}

describe("prompt persistence", () => {
  test("remote session migration does not import or remove an unscoped prompt", async () => {
    const id = "ses_remote_migration"
    const key = `session:${id}:prompt`
    const stored = JSON.stringify({
      prompt: [{ type: "text", content: "Local-only draft", start: 0, end: 16 }],
      context: { items: [] },
    })
    localStorage.setItem(key, stored)
    const scope = ServerScope.fromServerKey(ServerConnection.Key.make("https://remote.invalid"))

    const root = createRoot((dispose) => ({
      dispose,
      state: createComposerState(scope, { dir: base64Encode("C:/source"), id }, undefined, {
        ...platform,
        draftStore: undefined,
      }),
    }))

    await root.state.ready.promise
    expect(root.state.current()).toEqual([{ type: "text", content: "", start: 0, end: 0 }])
    expect(localStorage.getItem(key)).toBe(stored)
    root.dispose()
    localStorage.removeItem(key)
  })

  test("migrates complete directory draft documents to a move-stable session identity", async () => {
    const documents = new Map<string, string>()
    const blobs = new Map<string, Blob>()

    const drafts = createDraftStore({
      get: async (key) => documents.get(key) ?? null,
      set: async (key, value) => {
        documents.set(key, value)

        return []
      },
      remove: async (key) => void documents.delete(key),
      putBlob: async (blob) => {
        const id = Bun.hash(await blob.text()).toString(16)
        blobs.set(id, blob)

        return id
      },
      getBlob: async (id) => blobs.get(id) ?? null,
    })

    const id = "ses_composer_migration"
    const source = base64Encode("C:/projects/source")
    const previous = Persist.serverSession(ServerScope.local, source, id, "prompt")
    const target = Persist.serverGlobal(ServerScope.local, `session:${id}:prompt`)
    const blob = await drafts.putBlob(new Blob(["image bytes"], { type: "image/png" }))
    const text = "x".repeat(17000)

    const value = Schema.decodeUnknownSync(ComposerStore)({
      prompt: [
        { type: "text", content: text, start: 0, end: text.length },
        {
          type: "image",
          id: "image-migration",
          filename: "image.png",
          mime: "image/png",
          blob: { id: blob.id, url: "" },
        },
      ],
      cursor: 17,
      mode: "shell",
      model: { providerID: "opencode", modelID: "test" },
      context: {
        items: [
          { type: "file", path: "src/keep.ts", comment: "Keep this context", commentID: "comment-migration" },
          {
            type: "note",
            origin: "message-quote",
            label: "Message quote 1",
            icon: "message",
            subject: "Quoted assistant message",
            comment: "Keep this quote",
            commentID: "quote-migration",
            quote: {
              sessionID: id,
              messageID: "msg_quoted",
              userMessageID: "msg_user",
              partID: "msg_quoted:text:0",
              text: "The exact quote",
              start: 0,
              end: 15,
              before: "",
              after: "",
              number: 1,
            },
          },
        ],
      },
    })

    await drafts.setDocument(`${previous.storage}:${previous.key}`, Schema.encodeSync(ComposerStore)(value))
    const first = createRoot((dispose) => ({
      dispose,
      state: createComposerState(ServerScope.local, { dir: source, id }, undefined, {
        ...platform,
        draftStore: drafts,
      }),
    }))
    await first.state.ready.promise
    const restored = {
      ...value,
      prompt: [
        value.prompt[0],
        expect.objectContaining({ blob: { id: blob.id, url: expect.stringMatching(/^blob:/) } }),
      ],
    }
    expect(first.state.store[0]()).toEqual(restored)
    expect(documents.has(`${target.storage}:${target.key}`)).toBe(true)
    expect(documents.has(`${previous.storage}:${previous.key}`)).toBe(false)
    first.dispose()

    const moved = createRoot((dispose) => ({
      dispose,
      state: createComposerState(ServerScope.local, { dir: base64Encode("C:/projects/destination"), id }, undefined, {
        ...platform,
        draftStore: drafts,
      }),
    }))
    await moved.state.ready.promise
    expect(moved.state.store[0]()).toEqual(restored)
    expect(moved.state.context.items()[1]).toMatchObject({
      comment: "Keep this quote",
      commentID: "quote-migration",
      quote: {
        sessionID: id,
        messageID: "msg_quoted",
        userMessageID: "msg_user",
        partID: "msg_quoted:text:0",
        text: "The exact quote",
        start: 0,
        end: 15,
        before: "",
        after: "",
        number: 1,
      },
    })
    expect(await blobs.get(blob.id)?.text()).toBe("image bytes")
    moved.dispose()
  })

  test.each([null, "null", '"invalid"', "not json"])(
    "keeps dynamic initial input with unavailable stored state: %s",
    async (raw) => {
      const store = createDraftStore({
        get: async () => raw,
        set: async () => [],
        remove: async () => undefined,
        putBlob: async () => "unused",
        getBlob: async () => null,
      })

      const model = { providerID: "provider", modelID: "model", variant: "high" }

      const root = createRoot((dispose) => ({
        dispose,
        session: createComposerState(
          ServerScope.local,
          { draftID: `draft-initial-${raw}` },
          { prompt: "initial prompt", model },
          { ...platform, draftStore: store },
        ),
      }))

      await root.session.ready.promise
      expect(root.session.current()).toEqual([{ type: "text", content: "initial prompt", start: 0, end: 14 }])
      expect(root.session.cursor()).toBe(14)
      expect(root.session.model.current()).toEqual(model)
      root.dispose()
    },
  )

  test("decodes hydrated images and writes canonical blob references through draft storage", async () => {
    const documents = new Map<string, string>()
    const blobs = new Map<string, Blob>()

    const store = createDraftStore({
      get: async (key) => documents.get(key) ?? null,
      set: async (key, value) => {
        documents.set(key, value)

        return []
      },
      remove: async (key) => void documents.delete(key),
      putBlob: async (blob) => {
        blobs.set("composer-image", blob)

        return "composer-image"
      },
      getBlob: async (id) => blobs.get(id) ?? null,
    })

    const target = Persist.draft("draft-schema-image", "prompt")
    const key = `${target.storage}:${target.key}`
    await store.setItem(
      key,
      JSON.stringify({
        prompt: [
          {
            type: "image",
            id: "image",
            filename: "image.png",
            mime: "image/png",
            dataUrl: "data:image/png;base64,YQ==",
          },
        ],
      }),
    )

    const root = createRoot((dispose) => ({
      dispose,
      session: createComposerState(ServerScope.local, { draftID: "draft-schema-image" }, undefined, {
        ...platform,
        draftStore: store,
      }),
    }))

    await root.session.ready.promise
    // Bytes stay in the store until the image is shown or sent.
    expect(root.session.current()).toEqual([
      { type: "image", id: "image", filename: "image.png", mime: "image/png", blob: { id: "composer-image", url: "" } },
    ])
    expect(await resolveBlobUrl(root.session.current()[0]!.blob)).toStartWith("blob:")
    root.session.set([{ type: "text", content: "hello", start: 0, end: 5 }, ...root.session.current()])
    flushPersisted()
    await Bun.sleep(0)
    expect(documents.get(key)).toContain("hello")
    expect(documents.get(key)).toContain('"blob":{"id":"composer-image"}')
    expect(documents.get(key)).not.toContain("dataUrl")
    expect(documents.get(key)).not.toContain("blob:")
    root.dispose()
  })

  test("relocates a previous key into canonical storage", () => {
    localStorage.setItem("server.v3", JSON.stringify({ list: ["https://example.com"] }))

    const [state] = persisted(
      { ...Persist.global("server"), previousKey: "server.v3" },
      Schema.Struct({ list: Schema.mutable(Schema.Array(Schema.String)) }),
      { list: [] },
      platform,
    )

    expect(state.list).toEqual(["https://example.com"])
    expect(localStorage.getItem("opencode.global.dat:server")).toBe(JSON.stringify({ list: ["https://example.com"] }))
    expect(localStorage.getItem("server.v3")).toBeNull()
  })

  test("waits for an async draft to hydrate before reporting ready", async () => {
    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        const session = createComposerState(ServerScope.local, { draftID: "draft-async" }, undefined, platform)
        const ready = createComposerReady(() => session)

        expect(ready()).toBe(false)
        expect(session.current()[0]).toMatchObject({ type: "text", content: "" })

        read?.(
          JSON.stringify({
            prompt: [{ type: "text", content: "persisted draft", start: 0, end: 15 }],
            cursor: 15,
            context: { items: [] },
          }),
        )

        createEffect(() => {
          if (!ready()) return

          try {
            expect(session.current()[0]).toMatchObject({ type: "text", content: "persisted draft" })
            dispose()
            resolve()
          } catch (error) {
            dispose()
            reject(error)
          }
        })
      })
    })
  })

  test("relocates a current prompt into the draft store", async () => {
    const documents = new Map<string, string>()

    const store = createDraftStore({
      get: async (key) => documents.get(key) ?? null,
      set: async (key, value) => {
        documents.set(key, value)

        return []
      },
      remove: async (key) => void documents.delete(key),
      putBlob: async () => "blob",
      getBlob: async () => null,
    })

    const target = Persist.draft("draft-relocate", "prompt")
    const key = `${target.storage}:${target.key}`
    localStorage.setItem(
      key,
      JSON.stringify({
        prompt: [{ type: "text", content: "relocated draft", start: 0, end: 15 }],
        cursor: 15,
        context: { items: [] },
      }),
    )

    const session = createComposerState(ServerScope.local, { draftID: "draft-relocate" }, undefined, {
      ...platform,
      draftStore: store,
    })

    await session.ready.promise

    expect(session.current()[0]).toMatchObject({ type: "text", content: "relocated draft" })
    expect(documents.get(key)).toContain("relocated draft")
    expect(localStorage.getItem(key)).toBeNull()
  })

  test("relocates a previous prompt key into the draft store", async () => {
    const documents = new Map<string, string>()

    const store = createDraftStore({
      get: async (key) => documents.get(key) ?? null,
      set: async (key, value) => {
        documents.set(key, value)

        return []
      },
      remove: async (key) => void documents.delete(key),
      putBlob: async () => "blob",
      getBlob: async () => null,
    })

    const dir = "encoded-directory"
    const oldKey = `${dir}/prompt.v2`
    const target = Persist.prompt(Persist.serverScoped(ServerScope.local, dir, undefined, "prompt"))
    const key = `${target.storage}:${target.key}`
    localStorage.setItem(
      oldKey,
      JSON.stringify({
        prompt: [{ type: "text", content: "previous draft", start: 0, end: 14 }],
        cursor: 17,
        context: { items: [] },
      }),
    )

    const session = createComposerState(ServerScope.local, { dir }, undefined, { ...platform, draftStore: store })
    await session.ready.promise

    expect(session.current()[0]).toMatchObject({ type: "text", content: "previous draft" })
    expect(documents.get(key)).toContain("previous draft")
    expect(localStorage.getItem(oldKey)).toBeNull()
  })
})

test("moves image data URLs into blobs and resolves object URLs on demand", async () => {
  const documents = new Map<string, string>()
  const blobs = new Map<string, Blob>()

  const store = createDraftStore({
    get: async (key) => documents.get(key) ?? null,
    set: async (key, value) => {
      documents.set(key, value)

      return []
    },
    remove: async (key) => void documents.delete(key),
    putBlob: async (blob) => {
      const id = String(blob.size)
      blobs.set(id, blob)

      return id
    },
    getBlob: async (id) => blobs.get(id) ?? null,
  })

  await store.setItem("prompt", JSON.stringify({ prompt: [{ type: "image", dataUrl: "data:image/png;base64,YQ==" }] }))
  expect(documents.get("prompt")).not.toContain("dataUrl")
  const value = JSON.parse((await store.getItem("prompt"))!)
  expect(value.prompt[0].blob).toEqual({ id: "1" })
  expect(await resolveBlobUrl(value.prompt[0].blob)).toStartWith("blob:")
})

test("does not let delayed blob migration overwrite a newer draft", async () => {
  const documents = new Map<string, string>()
  const migration = Promise.withResolvers<void>()

  const store = createDraftStore({
    get: async () => null,
    set: async (key, value) => {
      documents.set(key, value)

      return []
    },
    remove: async () => undefined,
    putBlob: async () => {
      await migration.promise

      return "blob"
    },
    getBlob: async () => null,
  })

  const older = store.setItem(
    "prompt",
    JSON.stringify({ prompt: [{ type: "image", dataUrl: "data:image/png;base64,YQ==" }] }),
  )

  await Bun.sleep(0)
  await store.setItem("prompt", JSON.stringify({ prompt: [{ type: "text", content: "latest" }] }))
  migration.resolve()
  await older

  expect(documents.get("prompt")).toContain("latest")
})
