import { describe, expect, test } from "bun:test"
import { createWriteBehind } from "./write-behind"

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe("write-behind", () => {
  test("failed explicit flush or close preserves retryable writes even with an error reporter", () => {
    for (const operation of ["flush", "close"] as const) {
      const failure = new Error("fixture storage unavailable")
      const errors: unknown[] = []
      const batches: Map<string, number>[] = []
      let unavailable = true
      const writer = createWriteBehind<number>({
        delay: 1_000,
        write: (batch) => {
          if (unavailable) throw failure

          batches.push(batch)
        },
        onError: (error) => errors.push(error),
      })
      writer.set("draft", 1)
      expect(() => writer[operation]()).toThrow(failure)
      expect(writer.get("draft")).toBe(1)
      expect(errors).toEqual([failure])
      writer.set("draft", 2)
      unavailable = false
      writer.close()
      expect([...batches[0]!]).toEqual([["draft", 2]])
      expect(writer.has("draft")).toBe(false)
      writer.set("draft", 3)
      expect(writer.has("draft")).toBe(false)
    }
  })

  test("coalesces a burst into one batch with the latest value per key", async () => {
    const batches: Map<string, number>[] = []
    const writer = createWriteBehind<number>({ delay: 10, write: (batch) => batches.push(batch) })
    writer.set("a", 1)
    writer.set("b", 1)
    writer.set("a", 2)
    expect(writer.get("a")).toBe(2)
    expect(batches).toHaveLength(0)
    await wait(30)
    expect(batches).toHaveLength(1)
    expect([...batches[0]!]).toEqual([
      ["a", 2],
      ["b", 1],
    ])
    expect(writer.has("a")).toBe(false)
  })

  test("flush writes immediately and close stops accepting writes", () => {
    const batches: Map<string, number>[] = []
    const writer = createWriteBehind<number>({ delay: 1_000, write: (batch) => batches.push(batch) })
    writer.set("a", 1)
    writer.flush()
    expect(batches).toHaveLength(1)
    writer.set("b", 2)
    writer.close()
    expect(batches).toHaveLength(2)
    writer.set("c", 3)
    writer.flush()
    expect(batches).toHaveLength(2)
  })
})
