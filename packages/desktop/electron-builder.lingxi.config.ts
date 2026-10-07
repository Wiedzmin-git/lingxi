import type { Configuration } from "electron-builder"
import upstream from "./electron-builder.config"

const version = process.env.LINGXI_DESKTOP_VERSION

const updater = process.env.LINGXI_UPDATER_DIST

if (!version || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version))
  throw new Error("LINGXI_DESKTOP_VERSION must identify the exact local Desktop build")

if (!updater) throw new Error("LINGXI_UPDATER_DIST must contain the published standalone launcher helper and notices")

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
  extraResources: [
    ...(Array.isArray(upstream.extraResources) ? upstream.extraResources : []),
    { from: "icons/lingxi", to: "icons" },
    { from: updater, to: "lingxi-updater" },
  ],
  win: { ...upstream.win, executableName: "Lingxi", icon: "icons/lingxi/icon.ico" },
} satisfies Configuration
