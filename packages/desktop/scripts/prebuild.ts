#!/usr/bin/env bun
import { $ } from "bun"

import { copyBuiltCliToResources, resolveChannel } from "./utils"

const channel = resolveChannel()

if (!Bun.env.OPENCODE_CLI_DIST) {
  throw new Error("Lingxi desktop builds require OPENCODE_CLI_DIST from this checkout")
}

await $`bun ./scripts/copy-icons.ts ${channel}`

await $`bun ./scripts/copy-metainfo.ts ${channel}`

await copyBuiltCliToResources(Bun.env.OPENCODE_CLI_DIST)
