import { afterEach, expect, setSystemTime, test } from "bun:test"
import type { OpenCodeEvent } from "@opencode/client/promise"
import { GenerationSpeed } from "./generation-speed"

// Protects stream-window arithmetic and usage/timing provenance. Existing
// timeline tests observe rendering, not this five-second measurement contract.
const sessionID = "ses_speed"
const assistantMessageID = "msg_speed"
const tokens = { input: 1000, output: 80, reasoning: 20, cache: { read: 0, write: 0 } }
function event<Type extends OpenCodeEvent["type"]>(
  type: Type,
  data: Extract<OpenCodeEvent, { type: Type }>["data"],
  created = Date.now(),
): OpenCodeEvent {
  return {
    id: "evt_speed",
    type,
    data,
    created,
    durable: { aggregateID: sessionID, seq: 0, version: 1 },
  } as unknown as OpenCodeEvent
}
const start = () =>
  event(
    "session.step.started",
    { sessionID, assistantMessageID, agent: "build", model: { providerID: "test", id: "test" }, started: 1000 },
    1000,
  )
const delta = (text: string, created = Date.now()) =>
  event("session.text.delta", { sessionID, assistantMessageID, ordinal: 0, delta: text }, created)
afterEach(() => setSystemTime())

test("live estimate warms up, expires fragments at five seconds and counts visible reasoning, not input or tool tokens", () => {
  const meter = new GenerationSpeed()
  setSystemTime(1000)
  meter.observe(start())
  expect(meter.reading()).toBeUndefined()
  meter.observe(delta("abcd".repeat(100)))
  expect(meter.reading()).toEqual({ kind: "live", rate: undefined })
  setSystemTime(2000)
  expect(meter.reading()).toEqual({ kind: "live", rate: 100 })
  meter.observe(
    event("session.reasoning.delta", { sessionID, assistantMessageID, ordinal: 0, delta: "abcd".repeat(100) }),
  )
  meter.observe(
    event("session.tool.input.delta", { sessionID, assistantMessageID, id: "tool_1", delta: "abcd".repeat(100) }),
  )
  expect(meter.reading()).toEqual({ kind: "live", rate: 200 })
  setSystemTime(6000)
  expect(meter.reading()).toEqual({ kind: "live", rate: 20 })
  setSystemTime(7000)
  expect(meter.reading()).toEqual({ kind: "live", rate: 0 })
})

test("final request average uses all provider output and server request time, including TTFT but excluding tools", () => {
  const meter = new GenerationSpeed()
  setSystemTime(1_000_000) // browser/server wall clocks differ
  meter.observe(start())
  meter.observe(delta("tiny observed text", 5000))
  meter.observe(event("session.step.streamed", { sessionID, assistantMessageID }, 7000))
  expect(meter.reading()).toBeUndefined()
  meter.observe(delta("late fragment", 8000))
  expect(meter.reading()).toBeUndefined()
  meter.observe(event("session.step.ended", { sessionID, assistantMessageID, finish: "stop", cost: 0, tokens }, 70_000))
  expect(meter.reading()).toEqual({ kind: "average", rate: 100 / 6 })
  meter.observe(start())
  expect(meter.reading()).toBeUndefined()
})

test.each(["late subscription", "missing stream boundary", "zero span", "missing usage", "wrong step"])(
  "does not invent an average for %s",
  (scenario) => {
    const meter = new GenerationSpeed()
    setSystemTime(1000)
    if (scenario !== "late subscription") meter.observe(start())
    meter.observe(delta("hello", 5000))
    if (scenario !== "missing stream boundary")
      meter.observe(
        event("session.step.streamed", { sessionID, assistantMessageID }, scenario === "zero span" ? 1000 : 7000),
      )
    meter.observe(
      event(
        "session.step.ended",
        {
          sessionID,
          assistantMessageID: scenario === "wrong step" ? "msg_other" : assistantMessageID,
          finish: "stop",
          cost: 0,
          tokens: scenario === "missing usage" ? { ...tokens, output: 0, reasoning: 0 } : tokens,
        },
        8000,
      ),
    )
    expect(meter.reading()?.kind).not.toBe("average")
  },
)

test.each(["single batched answer", "tool-only output"])(
  "request average covers %s without inventing a first-token time",
  (scenario) => {
    const meter = new GenerationSpeed()
    setSystemTime(1000)
    meter.observe(start())
    if (scenario === "single batched answer") meter.observe(delta("All text arrived in one batch", 5999))
    if (scenario === "tool-only output") {
      meter.observe(
        event("session.tool.input.started", { sessionID, assistantMessageID, id: "tool_1", name: "bash" }, 3000),
      )
      meter.observe(
        event(
          "session.tool.input.ended",
          { sessionID, assistantMessageID, id: "tool_1", text: '{"command":"echo test"}' },
          5999,
        ),
      )
    }
    meter.observe(event("session.step.streamed", { sessionID, assistantMessageID }, 6000))
    meter.observe(
      event("session.step.ended", { sessionID, assistantMessageID, finish: "stop", cost: 0, tokens }, 60_000),
    )
    expect(meter.reading()).toEqual({ kind: "average", rate: 20 })
  },
)

test("does not present decaying text speed as tool-argument generation", () => {
  const meter = new GenerationSpeed()
  setSystemTime(1000)
  meter.observe(start())
  meter.observe(delta("Narration before a tool"))
  meter.observe(event("session.tool.input.started", { sessionID, assistantMessageID, id: "tool_1", name: "bash" }))
  expect(meter.reading()).toBeUndefined()
  meter.observe(
    event("session.tool.input.ended", { sessionID, assistantMessageID, id: "tool_1", text: '{"command":"echo test"}' }),
  )
  expect(meter.reading()).toBeUndefined()
})

test.each(["session.execution.interrupted", "session.execution.failed", "session.retry.scheduled"] as const)(
  "clears stale speed on %s",
  (type) => {
    const meter = new GenerationSpeed()
    setSystemTime(1000)
    meter.observe(start())
    meter.observe(delta("working"))
    const failure =
      type === "session.retry.scheduled"
        ? event(type, {
            sessionID,
            assistantMessageID,
            attempt: 1,
            at: 2000,
            error: { type: "provider.error", message: "retry" },
          })
        : type === "session.execution.failed"
          ? event(type, { sessionID, error: { type: "provider.error", message: "failed" } })
          : event(type, { sessionID, reason: "user" })
    meter.observe(failure)
    expect(meter.reading()).toBeUndefined()
  },
)
