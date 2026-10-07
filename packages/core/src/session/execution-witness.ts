import { Context } from "effect"
import type { Event } from "@opencode/schema/event"

/** Identity of the process-local busy period, inherited by its primary attempts. */
export const CurrentExecution = Context.Reference<Event.ID | undefined>("@opencode/Session/CurrentExecution", { defaultValue: () => undefined })
