import type { Configuration } from "electron-builder"
import upstream from "./electron-builder.config"

const version = process.env.LINGXI_DESKTOP_VERSION
if (!version || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version))
  throw new Error("LINGXI_DESKTOP_VERSION must identify the exact local Desktop build")

// Channels select immutable bytes through the independent launcher. They do not
// create another application identity or an upstream electron-updater feed.
export default {
  ...upstream,
  appId: "app.lingxi.desktop",
  productName: "Lingxi · 靈犀",
  artifactName: "Lingxi-${version}-${arch}.${ext}",
  extraMetadata: { ...upstream.extraMetadata, version },
  publish: [],
  protocols: [],
  extraFiles: [{ from: "../../LICENSE", to: "OPENCODE-LICENSE.txt" }],
  win: { ...upstream.win, executableName: "Lingxi" },
} satisfies Configuration
