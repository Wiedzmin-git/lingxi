import { expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { createHash, randomUUID } from "node:crypto"

test("explicit profile binding rejects incomplete identities and paths before selecting storage", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lingxi-binding-"))
  try {
    const id = randomUUID()
    const valid = {
      format: 1,
      id,
      desktopUserData: root,
      dataHome: root,
      configHome: root,
      cacheHome: root,
      stateHome: root,
      database: path.join(root, "history.db"),
      serviceRegistration: path.join(root, "registration.json"),
      serviceConfig: path.join(root, "service.json"),
      servicePort: 49278,
    }
    const file = path.join(root, "binding.json")
    const module = pathToFileURL(path.join(import.meta.dir, "../src/profile-binding.ts")).href
    for (const scenario of [
      "valid",
      "wrong-id",
      "relative",
      "missing-id",
      "missing-file",
      "bad-json",
      "bad-port",
      "bad-format",
      "bad-digest",
      ...(process.platform === "win32" ? ["root-relative-db", "root-relative-descriptor"] : []),
    ]) {
      const value = {
        ...valid,
        ...(scenario === "relative" ? { database: "relative.db" } : {}),
        ...(scenario === "bad-port" ? { servicePort: 0 } : {}),
        ...(scenario === "bad-format" ? { format: 2 } : {}),
        ...(scenario === "root-relative-db" ? { database: "\\profiles\\history.db" } : {}),
      }
      await writeFile(file, scenario === "bad-json" ? "{" : JSON.stringify(value))
      const result = Bun.spawnSync(
        [
          process.execPath,
          "-e",
          `const {profileBinding:p}=await import(${JSON.stringify(module)}); console.log(JSON.stringify({id:p.id,frozen:Object.isFrozen(p)}))`,
        ],
        {
          env: {
            ...process.env,
            LINGXI_PROFILE_BINDING:
              scenario === "root-relative-descriptor"
                ? file.slice(path.parse(file).root.length - 1)
                : scenario === "missing-file"
                  ? file + ".missing"
                  : file,
            LINGXI_PROFILE_ID: scenario === "missing-id" ? "" : scenario === "wrong-id" ? randomUUID() : id,
            LINGXI_PROFILE_DIGEST:
              scenario === "bad-digest"
                ? "0".repeat(64)
                : createHash("sha256")
                    .update(scenario === "bad-json" ? "{" : JSON.stringify(value))
                    .digest("hex"),
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      )
      if (scenario === "valid") {
        expect(result.exitCode, result.stderr.toString()).toBe(0)
        expect(JSON.parse(result.stdout.toString())).toEqual({ id, frozen: true })
      } else expect(result.exitCode, scenario).not.toBe(0)
      if (scenario === "root-relative-descriptor")
        expect(result.stderr.toString()).toContain("Incomplete Lingxi profile binding")
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
