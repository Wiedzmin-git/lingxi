import { Schema } from "effect"
import { Ipc } from "../sdk"

export const UpdaterState = Schema.Union([
  Schema.Struct({ status: Schema.Literal("disabled") }),
  Schema.Struct({ status: Schema.Literal("idle") }),
  Schema.Struct({ status: Schema.Literal("checking") }),
  Schema.Struct({ status: Schema.Literal("lingxi-bootstrap") }),
  Schema.Struct({
    status: Schema.Literal("downloading"),
    version: Schema.String,
    percent: Schema.optional(Schema.Number),
    received: Schema.optional(Schema.Number),
    total: Schema.optional(Schema.Number),
    bytesPerSecond: Schema.optional(Schema.Number),
    remainingSeconds: Schema.optional(Schema.Number),
  }),
  Schema.Struct({ status: Schema.Literal("ready"), version: Schema.String }),
  Schema.Struct({ status: Schema.Literal("download-required"), version: Schema.String }),
  Schema.Struct({ status: Schema.Literal("up-to-date") }),
  Schema.Struct({ status: Schema.Literal("installing"), version: Schema.String }),
  Schema.Struct({ status: Schema.Literal("error"), message: Schema.String }),
  Schema.Struct({
    status: Schema.Literal("lingxi-available"),
    version: Schema.String,
    sha256: Schema.String,
    channel: Schema.Literals(["dev", "stable"]),
  }),
  Schema.Struct({
    status: Schema.Literal("lingxi-staged"),
    version: Schema.String,
    sha256: Schema.String,
    channel: Schema.Literals(["dev", "stable"]),
  }),
])

export type UpdaterState = typeof UpdaterState.Type

export const UpdateSelection = Schema.Struct({ sha256: Schema.String, channel: Schema.Literals(["dev", "stable"]) })

export type UpdateSelection = typeof UpdateSelection.Type

export const UpdatePreferences = Schema.Struct({ automatic: Schema.Boolean, heartbeat: Schema.Boolean })

/** Persistent preferences shared by every Desktop window. */
export const UpdaterPreferences = Ipc.define({
  id: "updater-preferences",
  state: UpdatePreferences,
  methods: {
    configure: {
      input: Schema.Struct({ automatic: Schema.optional(Schema.Boolean), heartbeat: Schema.optional(Schema.Boolean) }),
    },
  },
})

/** The desktop app updater. Its state is app-wide; every window receives the same value. */
export const Updater = Ipc.define({
  id: "updater",
  state: UpdaterState,
  methods: {
    check: { output: UpdaterState },
    /** Upstream: restart/download. Lingxi: stage the last checked exact candidate for the next normal launch. */
    install: {},
    /** Lingxi only: stage the exact offer displayed to the user, without restarting. */
    stage: { input: UpdateSelection, output: UpdaterState },
    /** Lingxi only: apply this exact staged offer through the installation supervisor. */
    restart: { input: UpdateSelection },
  },
  events: {
    /** The app menu asks the focused window to check with in-app feedback (beta builds). */
    check: Schema.Null,
  },
})
