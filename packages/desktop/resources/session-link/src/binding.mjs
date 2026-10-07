import { createHash } from "node:crypto"
import path from "node:path"

export function bindingFile(policyFile, directory) {
  const normalized = path.resolve(directory)
  const name = createHash("sha256").update(process.platform === "win32" ? normalized.toLowerCase() : normalized).digest("hex")
  return path.join(path.dirname(policyFile), ".private", `binding-${name}.json`)
}
