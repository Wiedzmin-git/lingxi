import { readFile } from "node:fs/promises"
import type { Info } from "./service"

// Preservation needs evidence of absence, not merely a failed observation.
export async function readPreservedRegistration(file: string): Promise<Info | undefined> {
  const info: unknown = await readFile(file, "utf8")
    .then((text) => JSON.parse(text))
    .catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
      throw new Error("Service registration is unreadable or invalid; preservation policy forbids replacement")
    })
  if (info === undefined) return undefined
  if (
    typeof info !== "object" ||
    info === null ||
    !("url" in info) ||
    typeof info.url !== "string" ||
    !URL.canParse(info.url) ||
    !("pid" in info) ||
    typeof info.pid !== "number" ||
    !Number.isInteger(info.pid) ||
    info.pid <= 0 ||
    ("id" in info && typeof info.id !== "string") ||
    ("version" in info && typeof info.version !== "string") ||
    ("password" in info && typeof info.password !== "string")
  )
    throw new Error("Service registration is invalid; preservation policy forbids replacement")

  return info as Info
}
