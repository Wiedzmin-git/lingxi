import { Schema } from "effect"

export const LanConfig = Schema.Struct({ enabled: Schema.Boolean, host: Schema.String, publishHost: Schema.optionalKey(Schema.String), port: Schema.Number,
  outgoingNetworks: Schema.Array(Schema.String), outgoingPorts: Schema.Array(Schema.Number), retryHours: Schema.Number })
export const Contact = Schema.Struct({ addressRef: Schema.String, label: Schema.String,
  target: Schema.Struct({ installationID: Schema.String, sessionID: Schema.String }) })
const Reply = Schema.Struct({ installationID: Schema.String, sessionID: Schema.String, messageID: Schema.String })
const Send = Schema.Struct({ addressRef: Schema.String, text: Schema.String,
  mode: Schema.Literals(["wake", "queue", "steer"]), messageID: Schema.String, inReplyTo: Schema.optionalKey(Reply) })
export const SessionLinkRequest = Schema.Struct({
  operation: Schema.Literals(["status", "configure", "copy-address", "issue-address", "revoke-address", "set-wake", "import-contact", "contacts", "remove-contact", "mail", "send", "retry", "cancel"]),
  server: Schema.String,
  sessionID: Schema.optionalKey(Schema.String), config: Schema.optionalKey(LanConfig), wake: Schema.optionalKey(Schema.Boolean),
  invitation: Schema.optionalKey(Schema.String), label: Schema.optionalKey(Schema.String), addressRef: Schema.optionalKey(Schema.String),
  mailKey: Schema.optionalKey(Schema.String), message: Schema.optionalKey(Send),
})
export type SessionLinkRequest = typeof SessionLinkRequest.Type

export const Mail = Schema.Struct({ kind: Schema.Literals(["inbox", "outbox"]), mailKey: Schema.String, messageID: Schema.String,
  source: Schema.Struct({ installationID: Schema.String, sessionID: Schema.String, computer: Schema.String, user: Schema.String, title: Schema.String, agent: Schema.String }),
  target: Schema.Struct({ installationID: Schema.String, sessionID: Schema.String }),
  sentAt: Schema.Number, mode: Schema.Literals(["wake", "queue", "steer"]), text: Schema.String,
  status: Schema.String, attempts: Schema.Number, code: Schema.NullOr(Schema.String), wakeAdvised: Schema.Boolean,
  replyKey: Schema.NullOr(Schema.String), modelAttemptID: Schema.NullOr(Schema.String), observedAt: Schema.NullOr(Schema.Number),
  admissionStatus: Schema.String,
  receivedAt: Schema.NullOr(Schema.Number), observedIP: Schema.NullOr(Schema.String), replyToAddressRef: Schema.NullOr(Schema.String),
  inReplyTo: Schema.NullOr(Reply), attachments: Schema.Array(Schema.Struct({ name: Schema.String, mime: Schema.String, size: Schema.Number, sha256: Schema.String })),
})
export type Mail = typeof Mail.Type
export const SessionLinkResult = Schema.Struct({
  ok: Schema.optionalKey(Schema.Boolean), copied: Schema.optionalKey(Schema.Boolean), error: Schema.optionalKey(Schema.String),
  installationID: Schema.optionalKey(Schema.String), config: Schema.optionalKey(LanConfig), listener: Schema.optionalKey(Schema.String),
  branchAddress: Schema.optionalKey(Schema.Struct({ active: Schema.Boolean, wake: Schema.Boolean })),
  confidentiality: Schema.optionalKey(Schema.String), contacts: Schema.optionalKey(Schema.Array(Contact)), mail: Schema.optionalKey(Schema.Array(Mail)),
})
export type SessionLinkResult = typeof SessionLinkResult.Type
