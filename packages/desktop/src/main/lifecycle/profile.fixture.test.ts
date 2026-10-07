import { mock } from "bun:test"
import { Effect, Layer } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { profileBinding } from "@opencode/util/profile-binding"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { readFile, writeFile } from "node:fs/promises"

if (process.argv.includes("--profile-fixture")) await run()

async function run() {
  if (!profileBinding) throw new Error("fixture requires an explicit binding")
  const values: Record<string, string> = { appData: profileBinding.cacheHome }
  mock.module("electron", () => ({
    app: {
      isPackaged: true,
      setName: () => {},
      setAppUserModelId: () => {},
      commandLine: { appendSwitch: () => {}, getSwitchValue: () => "" },
      getPath: (key: string) => values[key],
      setPath: (key: string, value: string) => {
        values[key] = value
      },
    },
  }))
  mock.module("../constants", () => ({ APP_ID: "fixture.brand." + process.env.TEST_CHANNEL, APP_NAME: "fixture" }))
  const { configureApplication } = await import("./configure")
  const { databasePath } = await import("../../../../cli/src/database-path")
  const service = await import("../../../../cli/src/services/service-config")
  const { ServerConnection } = await import("../../../../cli/src/services/server-connection")
  const { ServerProcess } = await import("../../../../cli/src/server-process")
  const { spawnServiceContender } = await import("../../../../client/src/service-contender")
  const global = await Effect.runPromise(
    Effect.scoped(Global.Service.pipe(Effect.provide(LayerNode.compile(Global.node)))),
  )
  configureApplication()
  const options = await Effect.runPromise(
    service
      .options()
      .pipe(Effect.provide(Layer.succeed(Global.Service, Global.make())), Effect.provide(NodeFileSystem.layer)),
  )
  const readback = profileBinding.database + ".child-binding"
  const child = spawnServiceContender(
    process.execPath,
    [
      "-e",
      `const {profileBinding:p}=await import(${JSON.stringify(new URL("../../../../util/src/profile-binding.ts", import.meta.url).href)}); await Bun.write(${JSON.stringify(readback)},JSON.stringify({id:p.id,database:p.database}))`,
    ],
    options.env,
  )
  await new Promise<void>((resolve, reject) => {
    child.child.once("error", reject)
    child.child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(child.stderr()))))
  })
  child.release()
  const original = await readFile(profileBinding.serviceConfig, "utf8")
  const blocked: string[] = []
  for (const standalone of [false, true]) {
    await writeFile(profileBinding.serviceConfig, JSON.stringify({ disabled: !standalone }))
    const error = await Effect.runPromise(
      Effect.scoped(
        ServerConnection.resolve({ standalone }).pipe(
          Effect.flip,
          Effect.provide(Layer.succeed(Global.Service, Global.make())),
          Effect.provide(NodeFileSystem.layer),
        ),
      ),
    )
    blocked.push(error.message)
  }
  const privateMode = await Effect.runPromise(ServerProcess.run({ mode: "stdio", port: 0 }).pipe(Effect.flip))
  await writeFile(profileBinding.serviceConfig, original)
  console.log(
    JSON.stringify({
      userData: values.userData,
      database: databasePath("wrong-default"),
      registration: options.file,
      policy: options.existingService,
      ports: ["dev", "prod", "local"].map(service.defaultPort),
      roots: { data: Global.Path.data, config: Global.Path.config, state: Global.Path.state },
      config: await Effect.runPromise(
        service
          .read()
          .pipe(Effect.provide(Layer.succeed(Global.Service, Global.make())), Effect.provide(NodeFileSystem.layer)),
      ),
      acquiredConfig: global.config,
      childBinding: JSON.parse(await readFile(readback, "utf8")),
      blocked,
      privateMode: privateMode.message,
    }),
  )
}
