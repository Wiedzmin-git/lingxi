import type { PromptFileAttachment } from "@opencode/client/promise"

/** The selected rendered text and its stable message/part identity, independent of Markdown DOM nodes. */
export type SessionMessageQuote = {
  sessionID: string
  messageID: string
  userMessageID: string
  partID: string
  text: string
  start: number
  end: number
  before: string
  after: string
  number: number
}

export type SessionUserComment =
  | {
      type?: "file"
      path: string
      comment: string
      selection?: {
        startLine: number
        endLine: number
      }
    }
  | {
      /** A comment on something other than file lines, such as an element picked in a page. */
      type: "note"
      comment: string
      label: string
      icon: string
      quote?: SessionMessageQuote
    }

/** An attachment delivered to the model as a path on the server instead of inline bytes. */
export type SessionUserAttachmentReference = {
  name: string
  mime: string
  path: string
}

/** Immutable local branch identity and its span in the user's display text. */
export type SessionUserBranchReference = {
  sessionID: string
  title: string
  content: string
  start: number
  end: number
}

export type SessionUserActions = {
  openAttachment?: (file: PromptFileAttachment) => void
  revert?: (input: { sessionID: string; messageID: string }) => Promise<void> | void
  openQuote?: (quote: SessionMessageQuote, comment: string) => void
  /** A steer the server has not delivered yet. Like the TUI, it can move to the queue or be deleted. */
  pending?: {
    steer: (messageID: string) => boolean
    queue: (input: { sessionID: string; messageID: string }) => Promise<void>
    remove: (input: { sessionID: string; messageID: string }) => Promise<void>
  }
}
