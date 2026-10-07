import { expect, test } from "bun:test"
import { NodeFileSystem } from "@effect/platform-node"
import { mkdir } from "node:fs/promises"
import { Effect } from "effect"
import { Service } from "../src/promise/service"
import { ensure } from "../src/effect/service"
import type { EnsureOptions } from "../src/service"
import { serviceFixture } from "./fixture/service-fixture"
import { accelerate } from "./fixture/service-timing"

const clients = [
  { name: "promise", run: accelerate(Service.ensure) },
  {
    name: "effect",
    run: (options: EnsureOptions) =>
      Effect.runPromise(accelerate(ensure)(options).pipe(Effect.provide(NodeFileSystem.layer))),
  },
]

test("preserving clients adopt compatible services and never stop or replace existing incompatible/unavailable processes", async () => {
  for (const client of clients) {
    for (const scenario of ["compatible", "mismatch", "unavailable"] as const) {
      await using fixture = await serviceFixture()
      const child = fixture.spawn(scenario === "unavailable" ? "hanging" : "graceful")
      await fixture.waitForFile()
      const before = await Bun.file(fixture.registration).text()
      const starts: string[] = []
      const pending = client.run({
        file: fixture.registration,
        version: scenario === "mismatch" ? "next" : "test",
        existingService: "preserve",
        command: fixture.command("delayed", "10"),
        onStart: (reason) => starts.push(reason),
      })
      if (scenario === "compatible") expect((await pending).url).toBe(JSON.parse(before).url)
      else await expect(pending).rejects.toThrow("preservation policy forbids replacement")
      expect(starts, client.name + ":" + scenario).toEqual([])
      expect(await Bun.file(fixture.registration).text()).toBe(before)
      expect(await Bun.file(fixture.registration + ".signal").exists()).toBe(false)
      expect(child.exitCode).toBeNull()
    }
  }
}, 15_000)

test("preserving clients can start a service when no registration exists", async () => {
  for (const client of clients) {
    await using fixture = await serviceFixture()
    const endpoint = await client.run({
      file: fixture.registration,
      version: "test",
      existingService: "preserve",
      command: fixture.command("coordinated"),
    })
    const info = await Bun.file(fixture.registration).json()
    fixture.track(info.pid)
    expect(endpoint.url).toBe(info.url)
  }
}, 15_000)

test("preserving clients reject invalid or unreadable registrations without starting a process", async () => {
  for (const client of clients) {
    for (const content of ["{", "{}", '{"url":"not a url","pid":42}', "directory"]) {
      await using fixture = await serviceFixture()
      if (content === "directory") await mkdir(fixture.registration)
      else await Bun.write(fixture.registration, content)
      const starts: string[] = []
      await expect(
        client.run({
          file: fixture.registration,
          existingService: "preserve",
          command: fixture.command("record-start"),
          onStart: (reason) => starts.push(reason),
        }),
      ).rejects.toThrow()
      expect(starts).toEqual([])
      expect(await Bun.file(fixture.registration + ".started").exists()).toBe(false)
    }
  }
})

test("preserving clients let their own contender become healthy after more than three probe timeouts", async () => {
  for (const client of clients) {
    await using fixture = await serviceFixture()
    const pending = client.run({
      file: fixture.registration,
      version: "test",
      existingService: "preserve",
      command: fixture.command("delayed-health"),
    })
    await fixture.waitForFile()
    const info = await Bun.file(fixture.registration).json()
    fixture.track(info.pid)
    expect((await pending).url).toBe(info.url)
    expect((await Bun.file(fixture.registration + ".requests").text()).trim().split("\n")).toHaveLength(4)
    expect(await Bun.file(fixture.registration + ".signal").exists()).toBe(false)
  }
}, 15_000)
