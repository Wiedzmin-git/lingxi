import { mock } from "bun:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { MessageChannel } from "node:worker_threads"
import { Context, Effect, Layer, ManagedRuntime } from "effect"
import { RpcServer } from "effect/unstable/rpc"

if (process.argv.includes("--launcher-ipc-fixture")) await run()

async function run() {
  const state = { scenario: "ready", reports: 0, flushes: 0, authorized: 0 }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      assert.equal(request.headers.get("authorization"), "Basic " + btoa("opencode:synthetic"))
      state.authorized++
      return Response.json({ version: state.scenario === "version" ? "other" : "fixture-v1" })
    },
  })
  class Storage extends Context.Service<Storage, { flush: () => void }>()("fixture/launcher/storage") {}
  class Background extends Context.Service<
    Background,
    { connection: Effect.Effect<{ url: string; password: string }> }
  >()("fixture/launcher/background") {}
  class Cli extends Context.Service<Cli, { resolve: Effect.Effect<{ version: string }> }>()("fixture/launcher/cli") {}
  mock.module("electron", () => ({
    BrowserWindow: {
      fromWebContents: (contents: unknown) =>
        state.scenario === "sender" ? null : { isDestroyed: () => false, webContents: contents },
    },
  }))
  mock.module("../storage", () => ({ DesktopStorage: { Service: Storage } }))
  mock.module("../service/background-service", () => ({ BackgroundService: { Service: Background } }))
  mock.module("../service/desktop-cli", () => ({ DesktopCli: { Service: Cli } }))
  mock.module("../service/session-link", () => ({ sessionLinkReadyFor: () => state.scenario !== "link" }))
  mock.module("./launcher-readiness", () => ({
    launcherReadinessAccepted: () => state.reports > 0,
    reportLauncherReadiness: async () => {
      state.reports++
    },
  }))
  const { LauncherRpcs } = await import("../../shared/ipc-rpc/launcher")
  const { IpcPortHandoff, IpcServerProtocolLive } = await import("../ipc-transport")
  const { launcherHandlers } = await import("../ipc-handlers/launcher")
  const dependencies = Layer.mergeAll(
    Layer.succeed(Storage, {
      flush: () => {
        state.flushes++
        if (state.scenario === "storage") throw new Error("fixture write failure")
      },
    }),
    Layer.succeed(Background, { connection: Effect.succeed({ url: server.url.origin, password: "synthetic" }) }),
    Layer.succeed(Cli, { resolve: Effect.succeed({ version: "fixture-v1" }) }),
  )
  const runtime = ManagedRuntime.make(
    RpcServer.layer(LauncherRpcs, { disableFatalDefects: true }).pipe(
      Layer.provide(launcherHandlers.pipe(Layer.provide(dependencies))),
      Layer.provideMerge(IpcServerProtocolLive),
    ),
  )
  const handoff = await runtime.runPromise(IpcPortHandoff)
  const events = new EventEmitter()
  const channel = new MessageChannel()
  const listeners = new Map<Function, (data: unknown) => void>()
  // Test-side structural adapters mirror Electron's MessagePort event envelope.
  const port = {
    on(event: string, callback: (event: { data: unknown }) => void) {
      if (event !== "message") {
        channel.port1.on(event, callback)
        return
      }
      const listener = (data: unknown) => callback({ data })
      listeners.set(callback, listener)
      channel.port1.on(event, listener)
    },
    off(event: string, callback: (event: { data: unknown }) => void) {
      channel.port1.off(event, listeners.get(callback) ?? callback)
    },
    postMessage: channel.port1.postMessage.bind(channel.port1),
    start: () => channel.port1.start(),
    close: () => channel.port1.close(),
  }
  // SAFETY: the real transport uses exactly the port and sender methods provided by these adapters.
  handoff.bind(
    { id: 42, isDestroyed: () => false, once: events.once.bind(events), off: events.off.bind(events) } as never,
    port as never,
  )
  process.env.LINGXI_READINESS_PIPE = "fixture-present"
  try {
    for (const [id, scenario] of [
      "sender",
      "version",
      "link",
      "storage",
      "ready",
      "version",
      "storage",
      "sender",
    ].entries()) {
      state.scenario = scenario
      const reply = new Promise<{ exit: { _tag: string } }>((resolve) => channel.port2.once("message", resolve))
      channel.port2.postMessage({ _tag: "Request", id, tag: "AppReportStartupReady", payload: null, headers: [] })
      const result = await reply
      assert.equal(result.exit._tag, id >= 4 && scenario !== "sender" ? "Success" : "Failure", scenario)
      assert.equal(state.reports, id >= 4 ? 1 : 0, scenario)
    }
    assert.equal(state.flushes, 2)
    assert.equal(state.authorized, 4)
    console.log("raw startup IPC: 8 scenarios passed")
  } finally {
    channel.port2.close()
    await runtime.dispose()
    server.stop(true)
  }
}
