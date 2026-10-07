import { mock } from "bun:test"
import { Effect, Path } from "effect"

if (process.argv.includes("--environment-fixture")) {
  const scenario = process.argv.at(-1)
  const calls: string[] = []
  mock.module("electron", () => ({
    app: {
      isPackaged: true,
      getName: () => (scenario === "lingxi" ? "Lingxi · 靈犀" : "OpenCode Dev"),
      getVersion: () => "2.0.23",
      setAsDefaultProtocolClient: (name: string) => calls.push("os:" + name),
    },
  }))
  mock.module("@opencode/util/profile-binding", () => ({
    profileBinding: scenario === "bound" ? { id: "fixture" } : undefined,
  }))
  mock.module("../windows", () => ({
    registerRendererProtocol: () => calls.push("renderer"),
    setDockIcon: () => {},
    setProtocolReporter: () => {},
  }))
  mock.module("../service/shell-env", () => ({ getUserShell: () => null, loadShellEnv: () => Effect.succeed(null) }))
  mock.module("../native/logging", () => ({ scoped: (_scope: string, effect: Effect.Effect<void>) => effect }))
  const { APP_ID, APP_NAME } = await import("../constants")
  const { prepareDesktop } = await import("./environment")
  await Effect.runPromise(prepareDesktop.pipe(Effect.provide(Path.layer)))
  console.log(JSON.stringify({ id: APP_ID, name: APP_NAME, calls }))
}
