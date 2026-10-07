import type { OpenCodeEvent } from "@opencode/client/promise"

export type GenerationSpeedReading = { kind: "live" | "average"; rate?: number }

/** UI telemetry only. Provider usage is final; live byte/4 counts are estimates. */
export class GenerationSpeed {
  private messageID?: string
  private started?: number
  private streamed?: number
  private first?: number
  private live = false
  private average?: number
  private samples: { at: number; tokens: number }[] = []
  private encoder = new TextEncoder()

  reset() {
    this.messageID = undefined
    this.started = undefined
    this.streamed = undefined
    this.first = undefined
    this.live = false
    this.average = undefined
    this.samples = []
  }

  observe(event: OpenCodeEvent) {
    if (event.type === "session.step.started") {
      this.reset()
      this.messageID = event.data.assistantMessageID
      this.started = event.data.started
      return
    }
    if (event.type === "session.text.delta" || event.type === "session.reasoning.delta") {
      if (!event.data.delta || this.streamed !== undefined) return
      if (!this.messageID) this.messageID = event.data.assistantMessageID
      if (this.messageID !== event.data.assistantMessageID) return
      const now = Date.now()
      this.first ??= now
      this.live = true
      this.samples = this.samples.filter((sample) => sample.at > now - 5000)
      this.samples.push({ at: now, tokens: this.encoder.encode(event.data.delta).byteLength / 4 })
      return
    }
    if (event.type === "session.step.streamed" && event.data.assistantMessageID === this.messageID) {
      this.streamed = event.created
      this.live = false
      this.samples = []
      return
    }
    if (event.type === "session.step.ended" && event.data.assistantMessageID === this.messageID) {
      this.live = false
      const tokens = event.data.tokens.output + event.data.tokens.reasoning
      // Deltas are batched and not all provider output is streamed. Starting at
      // the first delta can discard generation time and inflate short answers.
      // Dispatch and stream end share the server clock and cover all reported usage.
      const elapsed =
        this.started === undefined || this.streamed === undefined ? undefined : this.streamed - this.started
      this.average = elapsed !== undefined && elapsed > 0 && tokens > 0 ? (tokens * 1000) / elapsed : undefined
      this.samples = []
      return
    }
    if (event.type === "session.tool.input.started" && event.data.assistantMessageID === this.messageID) {
      // This publisher does not emit argument deltas. Do not show a text-only
      // decaying reading as though it measured that tool-generation phase.
      this.live = false
      this.samples = []
      this.first = undefined
      return
    }
    if (
      (event.type === "session.step.failed" && event.data.assistantMessageID === this.messageID) ||
      event.type === "session.execution.interrupted" ||
      event.type === "session.execution.failed" ||
      event.type === "session.retry.scheduled"
    )
      this.reset()
  }

  reading(): GenerationSpeedReading | undefined {
    if (this.live && this.first !== undefined) {
      const now = Date.now()
      this.samples = this.samples.filter((sample) => sample.at > now - 5000)
      const seconds = Math.min(5000, now - this.first) / 1000
      return {
        kind: "live",
        rate: seconds >= 1 ? this.samples.reduce((sum, sample) => sum + sample.tokens, 0) / seconds : undefined,
      }
    }
    return this.average === undefined ? undefined : { kind: "average", rate: this.average }
  }
}
