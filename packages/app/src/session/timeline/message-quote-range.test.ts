import { describe, expect, test } from "bun:test"
import { messageQuoteRange } from "./message-quote-range"

const quote = {
  sessionID: "ses_source",
  messageID: "msg_source",
  userMessageID: "msg_user",
  partID: "msg_source:text:0",
  text: "same quote",
  start: 100,
  end: 110,
  before: "missing before",
  after: "missing after",
  number: 1,
}

describe("messageQuoteRange", () => {
  test("does not guess between repeated text when source context no longer matches", () => {
    const body = document.createElement("div")

    body.textContent = "same quote between same quote"
    expect(messageQuoteRange(body, quote)).toBeUndefined()
  })

  test("recovers an unambiguous occurrence after its original offset moves", () => {
    const body = document.createElement("div")

    body.textContent = "new prefix same quote"
    expect(messageQuoteRange(body, quote)?.toString()).toBe("same quote")
  })
})
