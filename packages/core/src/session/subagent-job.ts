export * as SubagentJob from "./subagent-job.js"

import { Effect, Scope } from "effect"
import { Job } from "../job.js"
import { Session } from "../session.js"
import { SubagentCompletion } from "./subagent-completion.js"

type Recovery = Extract<Job.Recovery, { kind: "subagent" }>

interface Runner {
  start: (recovery: Recovery, awaitResult?: boolean) => Effect.Effect<Job.Info>
  background: (recovery: Recovery) => Effect.Effect<void>
  notify: (recovery: Recovery, startedAt: number) => Effect.Effect<void>
}

export const run = Effect.fn("SubagentJob.run")(function* (sessions: Session.Interface, jobs: Job.Interface, recovery: Recovery) {
  return yield* Effect.gen(function* () {
    yield* sessions.resume(recovery.childSessionID)
    // A child may yield while its default-background tools run. Explicit
    // detached tasks do not delay the delegated result (e.g. a persistent server).
    while (yield* jobs.awaitBackground(recovery.childSessionID)) yield* sessions.wait(recovery.childSessionID)
    // awaitIdle deliberately suppresses execution failure. Do not select
    // an earlier successful 'waiting' message after a failed continuation.
    const outcome = (yield* sessions.get(recovery.childSessionID)).outcome
    if (outcome === "failed") return yield* Effect.fail(new Error("Subagent continuation failed"))
    if (outcome === "interrupted") return yield* Effect.interrupt
    const messages = yield* sessions.messages({ sessionID: recovery.childSessionID, order: "desc", limit: 20 })
    const assistant = messages.find(
      (message) => message.type === "assistant" && message.time.completed !== undefined && message.error === undefined,
    )
    return SubagentCompletion.text(assistant)
  })
})

export const cancel = Effect.fn("SubagentJob.cancel")(function* (sessions: Session.Interface, jobs: Job.Interface, recovery: Recovery) {
  yield* sessions.interrupt(recovery.childSessionID)
  yield* jobs.cancelBackground(recovery.childSessionID)
})

export const make: Effect.Effect<Runner, never, Session.Service | Job.Service | Scope.Scope> = Effect.gen(function* () {
  const sessions = yield* Session.Service
  const jobs = yield* Job.Service
  const scope = yield* Scope.Scope
  // One observer per job generation, including continuations of the same child.
  const notifications = new Set<string>()

  const notify = Effect.fn("SubagentJob.notify")(function* (recovery: Recovery, startedAt: number) {
    const key = `${recovery.childSessionID}:${startedAt}`
    if (notifications.has(key)) return
    notifications.add(key)
    yield* Effect.gen(function* () {
      const info = (yield* jobs.wait({ id: recovery.childSessionID })).info
      if (info) yield* SubagentCompletion.deliver(sessions, jobs, { ...info, recovery,
        resume: info.status !== "cancelled" || info.metadata?.awaitResult !== true })
    }).pipe(
      Effect.ensuring(Effect.sync(() => notifications.delete(key))),
      Effect.forkIn(scope, { startImmediately: true }),
    )
  })

  return {
    start: (recovery: Recovery, awaitResult = false) =>
      jobs.start({
        id: recovery.childSessionID,
        type: "subagent",
        title: recovery.description,
        metadata: { awaitResult },
        recovery,
        run: run(sessions, jobs, recovery),
        onCancel: cancel(sessions, jobs, recovery),
      }),
    background: Effect.fn("SubagentJob.background")(function* (recovery: Recovery) {
      const info = yield* jobs.background(recovery.childSessionID)
      if (info) yield* notify(recovery, info.started_at)
    }),
    notify,
  }
})
