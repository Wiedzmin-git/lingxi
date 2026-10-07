import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { mock } from "bun:test"
import { Context, Effect, Layer } from "effect"

if (process.argv.includes("--quit-fixture")) await run()

async function run() {
  // This subprocess drives the production Electron event handlers without
  // starting Electron or touching an installed application's profile.
  const events = new EventEmitter()
  const state = { flushes: 0, failAt: 0, quitting: false, quits: 0, relaunches: 0 }
  const app = Object.assign(events, {
    getPath: () => "synthetic-profile",
    relaunch: () => state.relaunches++,
    quit: () => {
      const event = quitEvent()
      events.emit("before-quit", event)
      if (!event.prevented) state.quits++
    },
  })
  class Storage extends Context.Service<Storage, { flush: () => void }>()("fixture/storage") {}
  const flush = () => {
    state.flushes++
    if (state.flushes === state.failAt) throw new Error("fixture persistence failure")
  }
  mock.module("electron", () => ({ app, BrowserWindow: { getAllWindows: () => [] } }))
  mock.module("../storage", () => ({ DesktopStorage: { Service: Storage, layer: Layer.succeed(Storage, { flush }) } }))
  mock.module("../native/logging", () => ({
    DesktopLogging: { layer: Layer.empty },
    scoped: (_name: string, effect: Effect.Effect<void>) => effect,
  }))
  mock.module("../ipc-events", () => ({ emitIpcEvent: () => {} }))
  mock.module("../windows/state", () => ({ safeWebContentsURL: () => "fixture" }))
  mock.module("./onboarding", () => ({ initializeFirstLaunchOnboarding: () => Effect.void }))
  mock.module("../windows", () => ({
    makeMainWindows: () => Effect.succeed({ create: () => undefined, restore: () => [] }),
    getLastFocusedWindow: () => null,
    getWindowByID: () => undefined,
    setAppQuitting: (value = true) => {
      state.quitting = value
    },
    setRelaunchHandler: () => () => {},
  }))
  const { ApplicationLifecycle } = await import("./index")
  const { Shutdown } = await import("./shutdown")

  for (const scenario of [
    "first-flush",
    "second-flush",
    "handoff-failure",
    "prepared-new-write",
    "reentrant",
    "relaunch-failure",
  ]) {
    Object.assign(state, { flushes: 0, failAt: 0, quitting: false, quits: 0, relaunches: 0 })
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const lifecycle = yield* ApplicationLifecycle.Service
          const shutdown = yield* Shutdown.Service
          let disposals = 0
          yield* shutdown.add(
            Effect.sync(() => {
              disposals++
            }),
          )
          if (scenario === "handoff-failure" || scenario === "prepared-new-write") {
            yield* lifecycle.prepareToRestart
            if (scenario === "handoff-failure") lifecycle.cancelRestart()
            state.failAt = state.flushes + 1
          }
          if (scenario === "first-flush" || scenario === "relaunch-failure") state.failAt = 1
          if (scenario === "second-flush") state.failAt = 2
          if (scenario === "relaunch-failure") {
            lifecycle.relaunch()
            yield* Effect.promise(() => until(() => state.flushes === 1 && !state.quitting))
            assert.equal(state.relaunches, 0)
            assert.equal(state.quits, 0)
            return
          }
          if (scenario === "reentrant") {
            const gate = Promise.withResolvers<void>()
            yield* shutdown.add(Effect.promise(() => gate.promise))
            const first = quitEvent()
            const second = quitEvent()
            events.emit("before-quit", first)
            events.emit("before-quit", second)
            assert(first.prevented && second.prevented)
            gate.resolve()
            yield* Effect.promise(() => until(() => state.quits === 1))
            assert.equal(disposals, 1)
            return
          }
          const event = quitEvent()
          events.emit("before-quit", event)
          assert(event.prevented)
          yield* Effect.promise(() => until(() => !state.quitting))
          assert.equal(state.quits, 0)
          state.failAt = 0
          app.quit()
          yield* Effect.promise(() => until(() => state.quits === 1))
          assert.equal(state.relaunches, 0)
          if (scenario === "handoff-failure" || scenario === "second-flush") assert.equal(disposals, 2)
        }).pipe(Effect.provide(ApplicationLifecycle.layer)),
      ),
    )
  }
  console.log("production quit handlers: 6 scenarios passed")

  function quitEvent() {
    return {
      prevented: false,
      preventDefault() {
        this.prevented = true
      },
    }
  }
  async function until(done: () => boolean) {
    const deadline = Date.now() + 2_000
    while (!done()) {
      if (Date.now() >= deadline) throw new Error("quit observation timed out")
      await Bun.sleep(5)
    }
  }
}
