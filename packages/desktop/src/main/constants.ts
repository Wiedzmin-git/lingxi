import { app } from "electron"

type Channel = "local" | "dev" | "beta" | "prod"
const raw = import.meta.env.OPENCODE_CHANNEL
export const CHANNEL: Channel = raw === "local" || raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"
export const VERSION = app.isPackaged ? app.getVersion() : (process.env.OPENCODE_VERSION ?? app.getVersion())

const appNames: Record<string, string> = {
  dev: "OpenCode Dev",
  beta: "OpenCode Beta",
  prod: "OpenCode",
}
const appIDs: Record<string, string> = {
  dev: "ai.opencode.desktop.dev",
  beta: "ai.opencode.desktop.beta",
  prod: "ai.opencode.desktop",
}
// Read the packaged productName before configureApplication sets the runtime name.
// Both packaging routes can use the same compiled main-process bytes.
export const LINGXI = app.isPackaged && app.getName() === "Lingxi · 靈犀"
export const APP_NAME = LINGXI ? "Lingxi · 靈犀" : app.isPackaged ? appNames[CHANNEL] : "OpenCode Dev"
export const APP_ID = LINGXI ? "app.lingxi.desktop" : app.isPackaged ? appIDs[CHANNEL] : "ai.opencode.desktop.dev"
