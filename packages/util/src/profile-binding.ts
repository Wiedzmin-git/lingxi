import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"

const paths = [
  "desktopUserData",
  "dataHome",
  "configHome",
  "cacheHome",
  "stateHome",
  "database",
  "serviceRegistration",
  "serviceConfig",
] as const

export type ProfileBinding = Readonly<
  Record<(typeof paths)[number], string> & {
    format: 1
    id: string
    servicePort: number
  }
>

// One explicit descriptor is frozen for this process. The launcher supplies
// both coordinates; neither branding nor a release channel selects data.
export const profileBinding = load()
export const profileEnvironment = profileBinding
  ? Object.freeze({
      LINGXI_PROFILE_BINDING: process.env.LINGXI_PROFILE_BINDING!,
      LINGXI_PROFILE_ID: profileBinding.id,
      ...(process.env.LINGXI_PROFILE_DIGEST ? { LINGXI_PROFILE_DIGEST: process.env.LINGXI_PROFILE_DIGEST } : {}),
      OPENCODE_CONFIG_DIR: path.join(profileBinding.configHome, "opencode"),
      OPENCODE_DB: profileBinding.database,
      XDG_DATA_HOME: profileBinding.dataHome,
      XDG_CONFIG_HOME: profileBinding.configHome,
      XDG_CACHE_HOME: profileBinding.cacheHome,
      XDG_STATE_HOME: profileBinding.stateHome,
    })
  : undefined

function load(): ProfileBinding | undefined {
  const file = process.env.LINGXI_PROFILE_BINDING
  const id = process.env.LINGXI_PROFILE_ID
  if (file === undefined && id === undefined) return
  if (!file || !fullyQualified(file) || !id) throw new Error("Incomplete Lingxi profile binding")
  const bytes = readFileSync(file)
  const digest = process.env.LINGXI_PROFILE_DIGEST
  if (
    digest !== undefined &&
    (!/^[a-f0-9]{64}$/.test(digest) || createHash("sha256").update(bytes).digest("hex") !== digest)
  )
    throw new Error("Lingxi profile descriptor digest mismatch")
  const value: unknown = JSON.parse(bytes.toString("utf8"))
  if (
    typeof value !== "object" ||
    value === null ||
    !("format" in value) ||
    value.format !== 1 ||
    !("id" in value) ||
    typeof value.id !== "string" ||
    !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value.id) ||
    !("servicePort" in value) ||
    typeof value.servicePort !== "number" ||
    !Number.isInteger(value.servicePort) ||
    value.servicePort < 1 ||
    value.servicePort > 65_535
  )
    throw new Error("Invalid Lingxi profile binding")
  if (value.id !== id) throw new Error("Lingxi profile identity mismatch")
  // SAFETY: the JSON boundary above established a non-null object; fields remain unknown until checked below.
  const fields = value as Record<string, unknown>
  if (
    paths.some((key) => {
      const entry = fields[key]
      return typeof entry !== "string" || !fullyQualified(entry)
    })
  )
    throw new Error("Lingxi profile binding requires absolute paths")
  // SAFETY: format, identity, integer port and every required path were validated at this boundary.
  return Object.freeze(value as ProfileBinding)
}

function fullyQualified(value: string) {
  if (process.platform !== "win32") return path.isAbsolute(value)
  return /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+(?:[\\/]|$))/.test(value)
}
