import { describe, expect, test } from "bun:test"
import { commentContextItem, readCommentMetadata, readPromptPresentation } from "./comment-note"
import { createMemoryComposerState } from "./state"

const durable = {
  type: "note" as const,
  origin: "example",
  label: "button#save",
  icon: "select-element",
  subject: 'the "button#save" element',
  href: "tab_00000000-0000-4000-8000-000000000000",
  comment: "Rename this",
}

const note = { ...durable, live: { subject: 'the "button#save" element (browser ref @e42)' } }

describe("extension notes", () => {
  test("read from message metadata beside file comments and skip malformed entries", () => {
    // Metadata a build before extension notes sent for a browser element comment.
    const browser = {
      type: "browser",
      tabID: "tab_00000000-0000-4000-8000-000000000000",
      url: "http://localhost:5173/settings",
      title: "Settings",
      element: {
        ref: "e42",
        selector: "#settings > button.primary",
        label: "button.primary",
        role: "button",
        name: "Save",
        text: "Save",
      },
      comment: "Match @src/button.css",
    }

    const value = readPromptPresentation({
      displayText: "hi",
      comments: [
        note,
        { ...note, label: 42 },
        browser,
        { ...browser, element: { label: "button" } },
        { path: "src/app.ts", comment: "Keep" },
        {
          type: "unexpected",
          path: "src/legacy.ts",
          comment: "Keep valid fields",
          selection: { startLine: "bad" },
          preview: 42,
          origin: "unknown",
        },
      ],
    })

    expect(value?.comments).toEqual([
      note,
      {
        type: "note",
        origin: "browser",
        label: "button.primary",
        icon: "select-element",
        subject:
          'the "button.primary" element in browser tab tab_00000000-0000-4000-8000-000000000000 at http://localhost:5173/settings (role button; accessible name "Save"; selector "#settings > button.primary")',
        href: "tab_00000000-0000-4000-8000-000000000000",
        comment: "Match @src/button.css",
      },
      { path: "src/app.ts", comment: "Keep" },
      { path: "src/legacy.ts", comment: "Keep valid fields" },
    ])
  })

  test("keeps valid legacy comment metadata when optional fields are malformed", () => {
    expect(
      readCommentMetadata({
        opencodeComment: {
          path: "src/legacy.ts",
          comment: "Keep valid fields",
          selection: { startLine: 1 },
          preview: false,
          origin: "unknown",
        },
      }),
    ).toEqual({ path: "src/legacy.ts", comment: "Keep valid fields" })
  })

  test("update and detach by commentID reach notes as well as file comments", () => {
    const context = createMemoryComposerState().context
    context.add({ type: "file", path: "src/app.ts", comment: "Keep", commentID: "file" })
    context.add({ ...note, commentID: "note" })
    context.updateComment("note", { comment: "Rename that" })
    context.updateComment("file", { comment: "Keep this" })
    expect(context.items().map((item) => [item.commentID, item.comment])).toEqual([
      ["file", "Keep this"],
      ["note", "Rename that"],
    ])
    context.removeComment("note")
    expect(context.items().map((item) => item.commentID)).toEqual(["file"])
  })

  test("return to the composer without their live part", () => {
    expect(commentContextItem(note)).toEqual({ ...durable, commentID: expect.any(String) })

    const quote = {
      sessionID: "ses_original",
      messageID: "msg_original",
      userMessageID: "msg_user",
      partID: "msg_original:text:0",
      text: "The exact quote",
      start: 0,
      end: 15,
      before: "",
      after: "",
      number: 1,
    }

    expect(commentContextItem({ ...note, origin: "message", quote })).toEqual({
      ...durable,
      origin: "message",
      quote,
      commentID: expect.any(String),
    })
  })
})
