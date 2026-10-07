import assert from "node:assert/strict"
import { test } from "node:test"
import { parseMessage } from "../src/delivery.mjs"
import { parseSend } from "../src/r2-tool-input.mjs"

for (const target of [{ targetSessionID: "ses_local" }, { addressRef: "addr_11111111-1111-4111-8111-111111111111" }]) {
  test(`ordinary and directed send at ${Object.keys(target)[0]}`, () => {
    const input = { ...target, text: "Please continue", messageID: "same-logical-message" }
    assert.equal(parseSend(input).mode, "wake")
    for (const mode of ["wake", "steer"]) {
      const parsed = parseSend({ ...input, mode })
      assert.equal(parsed.mode, mode)
      assert.equal(parsed.messageID, input.messageID)
      assert.equal(parsed.text, input.text)
    }
    for (const mode of ["queue", "", "interrupt", null]) {
      assert.throws(() => parseSend({ ...input, mode }), /sending mode/)
    }
  })
}

test("external local gateway also defaults to waking and rejects silent new sends", () => {
  const input = { targetSessionID: "ses_gateway", text: "Report ready", messageID: "external-one" }
  assert.equal(parseMessage(input).mode, "wake")
  assert.throws(() => parseMessage({ ...input, mode: "queue" }), /sending mode/)
})

test("remote default retains exact reply identity and attachment request", () => {
  const input = { addressRef: "addr_11111111-1111-4111-8111-111111111111", text: "Review attached",
    messageID: "reply-one", inReplyTo: { installationID: "ins_11111111-1111-4111-8111-111111111111", sessionID: "ses_original", messageID: "original" },
    attachments: [{ path: "C:/review.txt", name: "review.txt", mime: "text/plain" }] }
  const parsed = parseSend(input)
  assert.deepEqual(parsed, { ...input, mode: "wake" })
})
