import { describe, expect, test } from "bun:test"
import type { Prompt } from "@/composer/state"
import { prependHistoryEntry, removeHistoryEntry, type PromptHistoryComment } from "./entry"

const DEFAULT_PROMPT: Prompt = [{ type: "text", content: "", start: 0, end: 0 }]

const text = (value: string): Prompt => [{ type: "text", content: value, start: 0, end: value.length }]
const comment = (id: string, value = "note"): PromptHistoryComment => ({
  id,
  path: "src/a.ts",
  selection: { start: 2, end: 4 },
  comment: value,
  time: 1,
  origin: "review",
  preview: "const a = 1",
})

describe("Composer history", () => {
  test("prependHistoryEntry skips empty prompt and deduplicates consecutive entries", () => {
    const first = prependHistoryEntry([], DEFAULT_PROMPT)
    expect(first).toEqual([])

    const commentsOnly = prependHistoryEntry([], DEFAULT_PROMPT, [comment("c1")])
    expect(commentsOnly).toHaveLength(1)

    const withOne = prependHistoryEntry([], text("hello"))
    expect(withOne).toHaveLength(1)

    const deduped = prependHistoryEntry(withOne, text("hello"))
    expect(deduped).toBe(withOne)

    const dedupedComments = prependHistoryEntry(commentsOnly, DEFAULT_PROMPT, [comment("c1")])
    expect(dedupedComments).toBe(commentsOnly)
  })

  test("removeHistoryEntry drops the entry recorded for a prompt and leaves others alone", () => {
    const image: Prompt = [
      { type: "text", content: "look", start: 0, end: 4 },
      { type: "image", id: "img", filename: "big.png", mime: "image/png", blob: { id: "hash", url: "" } },
    ]
    const entries = prependHistoryEntry(prependHistoryEntry([], text("earlier")), image, [comment("c1")])
    expect(entries).toHaveLength(2)

    const untouched = removeHistoryEntry(entries, text("never sent"))
    expect(untouched).toBe(entries)

    const withoutComments = removeHistoryEntry(entries, image)
    expect(withoutComments).toBe(entries)

    const removed = removeHistoryEntry(entries, image, [comment("c1")])
    expect(removed).toEqual(prependHistoryEntry([], text("earlier")))
  })

  test("history keeps exact branch identities, origins and saved spans despite identical titles", () => {
    const reference = { type: "session" as const, server: "server-a", sessionID: "ses_first", title: "Same title", content: "Same title", start: 0, end: 10 }
    const entries = prependHistoryEntry([], [reference])
    expect(prependHistoryEntry(entries, [{ ...reference }])).toBe(entries)
    for (const changed of [{ sessionID: "ses_second" }, { server: "server-b" }, { title: "Renamed" }, { content: "Renamed" }, { start: 1 }, { end: 9 }]) {
      const prompt: Prompt = [{ ...reference, ...changed }]
      const distinct = prependHistoryEntry(entries, prompt)
      expect(distinct).toHaveLength(2)
      expect(distinct[0].prompt).toEqual(prompt)
      expect(removeHistoryEntry(distinct, prompt)).toEqual(entries)
    }
    const reordered: Prompt = [reference, { ...reference, sessionID: "ses_second" }]
    expect(prependHistoryEntry(prependHistoryEntry([], reordered), [...reordered].reverse())).toHaveLength(2)
  })

  test("insertion isolates canonical entries from source mutations", () => {
    const prompt: Prompt = [
      {
        type: "file",
        path: "src/a.ts",
        content: "@src/a.ts",
        start: 0,
        end: 9,
        selection: { startLine: 1, startChar: 0, endLine: 2, endChar: 0 },
      },
    ]
    const comments = [comment("c1")]
    const entries = prependHistoryEntry([], prompt, comments)
    const stored = entries[0]

    if (prompt[0]?.type !== "file" || stored?.prompt[0]?.type !== "file") throw new Error("expected file")
    prompt[0].selection!.startLine = 9
    comments[0].selection.start = 9

    expect(stored.prompt[0].selection?.startLine).toBe(1)
    expect(stored.comments[0]?.selection.start).toBe(2)
  })
})
