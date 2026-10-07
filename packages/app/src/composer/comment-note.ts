import { Option, Schema, SchemaGetter } from "effect"
import type { SessionMessageUser } from "@opencode/client/promise"
import { FileSelection } from "@/workspaces/files/types"
import { durableNote, LegacyBrowserNote, NoteComment, SessionReferencePart, type ContextItem } from "./schema"

export const PromptFileComment = Schema.Struct({
  type: Schema.optional(Schema.Literal("file")),
  path: Schema.String,
  selection: Schema.optional(FileSelection),
  comment: Schema.String,
  preview: Schema.optional(Schema.String),
  origin: Schema.optional(Schema.Literals(["review", "file"])),
})

export type PromptFileComment = typeof PromptFileComment.Type

export type PromptComment = PromptFileComment | NoteComment

const PromptFileCommentInput = Schema.Struct({
  type: Schema.optional(Schema.Unknown),
  path: Schema.String,
  selection: Schema.optional(Schema.Unknown),
  comment: Schema.String,
  preview: Schema.optional(Schema.Unknown),
  origin: Schema.optional(Schema.Unknown),
})

const decodeFileSelection = Schema.decodeUnknownOption(FileSelection)

const decodeString = Schema.decodeUnknownOption(Schema.String)

const decodeCommentOrigin = Schema.decodeUnknownOption(Schema.Literals(["review", "file"]))

const PromptFileCommentFromInput = PromptFileCommentInput.pipe(
  Schema.decodeTo(Schema.toType(PromptFileComment), {
    decode: SchemaGetter.transform((input) => {
      const selection = Option.getOrUndefined(decodeFileSelection(input.selection))
      const preview = Option.getOrUndefined(decodeString(input.preview))
      const origin = Option.getOrUndefined(decodeCommentOrigin(input.origin))
      const comment = { path: input.path, comment: input.comment }
      const typed = input.type === "file" ? ({ ...comment, type: "file" } satisfies PromptFileComment) : comment
      const selected = selection ? { ...typed, selection } : typed
      const previewed = preview !== undefined ? { ...selected, preview } : selected

      return origin ? { ...previewed, origin } : previewed
    }),
    encode: SchemaGetter.transform((input) => input),
  }),
)

const decodeCommentMetadata = Schema.decodeUnknownOption(Schema.Struct({ opencodeComment: PromptFileCommentFromInput }))

const decodePromptComment = Schema.decodeUnknownOption(
  Schema.Union([NoteComment, LegacyBrowserNote, PromptFileCommentFromInput]),
)

const decodePromptAttachmentReference = Schema.decodeUnknownOption(
  Schema.Struct({ name: Schema.String, mime: Schema.String, path: Schema.String }),
)

const decodePromptPresentation = Schema.decodeUnknownOption(
  Schema.Struct({
    displayText: Schema.String,
    attachments: Schema.optional(Schema.Array(Schema.Unknown)),
    comments: Schema.Array(Schema.Unknown),
    sessionReferences: Schema.optional(Schema.Array(SessionReferencePart)),
  }),
)

/** An attachment the model receives as a path on the server rather than inline bytes. */
export type PromptAttachmentReference = {
  name: string
  mime: string
  path: string
}

export function createCommentMetadata(input: PromptFileComment) {
  return {
    opencodeComment: {
      path: input.path,
      selection: input.selection,
      comment: input.comment,
      preview: input.preview,
      origin: input.origin,
    },
  }
}

export function readCommentMetadata(value: SessionMessageUser["metadata"]) {
  return Option.getOrUndefined(decodeCommentMetadata(value))?.opencodeComment
}

export function readPromptPresentation(value: SessionMessageUser["metadata"]) {
  const presentation = Option.getOrUndefined(decodePromptPresentation(value))

  if (!presentation) return

  return {
    displayText: presentation.displayText,
    attachments: (presentation.attachments ?? []).flatMap((item) =>
      Option.toArray(decodePromptAttachmentReference(item)),
    ),
    comments: presentation.comments.flatMap((item) => Option.toArray(decodePromptComment(item))),
    sessionReferences: [...(presentation.sessionReferences ?? [])],
  }
}

export function formatAttachmentReference(input: PromptAttachmentReference) {
  return `Attached file: \`${input.path}\``
}

/** A note reads with its live subject while it stays in the app process that attached it. */
export function formatNoteComment(input: NoteComment) {
  if (input.quote) {
    const quote = input.quote

    return `Message quote ${quote.number}\nSource: ${JSON.stringify({ sessionID: quote.sessionID, messageID: quote.messageID, partID: quote.partID })}\nQuoted text (reference): ${JSON.stringify(quote.text)}\nUser comment: ${input.comment}`
  }

  return `The user made the following comment regarding ${input.live?.subject ?? input.subject}: ${input.comment}`
}

/** Restores a sent comment to the composer, for example after a revert or fork. */
export function commentContextItem(comment: PromptComment): ContextItem {
  // The message may predate this app process, so a note's live references can no longer be trusted.
  if (comment.type === "note") return { ...durableNote(comment), commentID: crypto.randomUUID() }

  return {
    type: "file",
    path: comment.path,
    selection: comment.selection,
    comment: comment.comment,
    preview: comment.preview,
    commentOrigin: comment.origin,
  }
}

export function formatCommentNote(input: { path: string; selection?: FileSelection; comment: string }) {
  const start = input.selection ? Math.min(input.selection.startLine, input.selection.endLine) : undefined
  const end = input.selection ? Math.max(input.selection.startLine, input.selection.endLine) : undefined

  const range =
    start === undefined || end === undefined
      ? "this file"
      : start === end
        ? `line ${start}`
        : `lines ${start} through ${end}`

  return `The user made the following comment regarding ${range} of ${input.path}: ${input.comment}`
}

export function parseCommentNote(text: string) {
  const match = text.match(
    /^The user made the following comment regarding (this file|line (\d+)|lines (\d+) through (\d+)) of (.+?): ([\s\S]+)$/,
  )

  if (!match) return
  const start = match[2] ? Number(match[2]) : match[3] ? Number(match[3]) : undefined
  const end = match[2] ? Number(match[2]) : match[4] ? Number(match[4]) : undefined

  return {
    path: match[5],
    selection:
      start !== undefined && end !== undefined
        ? {
            startLine: start,
            startChar: 0,
            endLine: end,
            endChar: 0,
          }
        : undefined,
    comment: match[6],
  } satisfies PromptComment
}
