import { expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { randomUUID } from "node:crypto"

test("Desktop and CLI use the same explicit storage and service across branded channels", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lingxi-bound-profile-"))
  try {
    const binding = {
      format: 1,
      id: randomUUID(),
      desktopUserData: path.join(root, "legacy-desktop"),
      dataHome: path.join(root, "data"),
      configHome: path.join(root, "config"),
      cacheHome: path.join(root, "cache"),
      stateHome: path.join(root, "state"),
      database: path.join(root, "history.db"),
      serviceRegistration: path.join(root, "existing-service.json"),
      serviceConfig: path.join(root, "existing-config.json"),
      servicePort: 49278,
    }
    const file = path.join(root, "binding.json")
    await mkdir(path.join(binding.desktopUserData, "session-link"), { recursive: true })
    const identity = path.join(binding.desktopUserData, "session-link", "fixture-identity")
    await writeFile(identity, binding.id)
    await writeFile(binding.database, "fixture-history-not-a-live-database")
    const serviceConfig = {
      port: binding.servicePort,
      env: {
        LINGXI_PROFILE_BINDING: path.join(root, "foreign-binding.json"),
        LINGXI_PROFILE_ID: randomUUID(),
        OPENCODE_CONFIG_DIR: path.join(root, "foreign-config"),
      },
    }
    await writeFile(
      path.join(root, "foreign-binding.json"),
      JSON.stringify({ ...binding, id: serviceConfig.env.LINGXI_PROFILE_ID, database: path.join(root, "foreign.db") }),
    )
    await writeFile(binding.serviceConfig, JSON.stringify(serviceConfig))
    await writeFile(file, JSON.stringify(binding))
    for (const channel of ["dev", "stable"]) {
      const result = Bun.spawnSync(
        [process.execPath, path.join(import.meta.dir, "profile.fixture.test.ts"), "--profile-fixture"],
        {
          env: {
            ...process.env,
            LINGXI_PROFILE_BINDING: file,
            LINGXI_PROFILE_ID: binding.id,
            TEST_CHANNEL: channel,
            NODE_DISABLE_COMPILE_CACHE: "1",
            OPENCODE_DESKTOP_PROFILE_ROOT: "",
            OPENCODE_DESKTOP_TEST_ROOT: "",
            OPENCODE_TEST_ONBOARDING: "0",
            OPENCODE_DESKTOP_ISOLATED_SERVER: "0",
            OPENCODE_DB: "wrong-channel.db",
            XDG_DATA_HOME: path.join(root, "wrong-data"),
            OPENCODE_CONFIG_DIR: path.join(root, "foreign-config"),
            TEMP: path.join(root, "temp"),
            TMP: path.join(root, "temp"),
            TMPDIR: path.join(root, "temp"),
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      )
      expect(result.exitCode, result.stderr.toString()).toBe(0)
      expect(JSON.parse(result.stdout.toString())).toEqual({
        userData: binding.desktopUserData,
        database: binding.database,
        registration: binding.serviceRegistration,
        policy: "preserve",
        ports: [binding.servicePort, binding.servicePort, binding.servicePort],
        roots: {
          data: path.join(binding.dataHome, "opencode"),
          config: path.join(binding.configHome, "opencode"),
          state: path.join(binding.stateHome, "opencode"),
        },
        config: serviceConfig,
        acquiredConfig: path.join(binding.configHome, "opencode"),
        childBinding: { id: binding.id, database: binding.database },
        blocked: [
          "Standalone mode conflicts with the Lingxi profile binding",
          "Standalone mode conflicts with the Lingxi profile binding",
        ],
        privateMode: "Lingxi profile requires its bound managed service",
      })
      expect(await readFile(identity, "utf8")).toBe(binding.id)
      expect(await readFile(binding.database, "utf8")).toBe("fixture-history-not-a-live-database")
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
