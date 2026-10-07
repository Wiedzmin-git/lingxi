import { expect, test, type Locator, type Page } from "@playwright/test"
import { NO_PROVIDER, T0, provider, session, SERVER, REMOTE_SERVER } from "../utils/app"
import { mockRemoteServer, openDraft, openSession } from "../utils/workspace"
import type { SessionMessageInfo } from "@opencode/client/promise"
import { storedSessionDraft } from "../utils/drafts"
import type { MockServerConfig } from "../utils/mock-server"
import { sessionHref } from "../utils/app"

test.use({ permissions: ["clipboard-read", "clipboard-write"] })

for (const surface of ["horizontal", "vertical", "compact", "horizontal-title", "vertical-title"] as const) {
test(`drags inactive branches into ordered removable chips without switching or sending (${surface})`, async ({ page }) => {
  const admissions: Parameters<NonNullable<MockServerConfig["onPrompt"]>>[0][] = []
  const target = "ses_ref_current"
  const peers = [{ id: "ses_ref_first", title: 'ЦОН "<b>"' }, { id: "ses_ref_second", title: 'ЦОН "<b>"' }]
  const tabLayout = surface.startsWith("vertical") ? "vertical" : "horizontal"
  const titleDrag = surface.endsWith("-title")
  const dense = surface === "compact" ? Array.from({ length: 36 }, (_, index) => ({ id: `ses_dense_${index}`, title: `Dense ${index}` })) : []
  const { editor } = await openSession(page, { name: "BranchReferences", sessionID: target,
    sessions: [{ id: target, title: "Current branch" }, ...peers, ...dense], seed: { settings: { appearance: { tabLayout } } }, onPrompt: (input) => admissions.push(input) })
  await editor.fill("before ")
  const source = (id: string) => page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(id)}"]) ${titleDrag ? "[data-titlebar-tab-title]" : "[data-session-reference-drag]"}`)
  if (!titleDrag) {
    await source(peers[0].id).click()
    await expect(page).toHaveURL(new RegExp(`${target}$`))
    await expect(source(peers[0].id)).toHaveAttribute("title", "Drag branch reference into a prompt")
  }
  await source(peers[0].id).hover()
  await page.mouse.down()
  await editor.hover()
  await editor.hover()
  await expect(page.getByText("Drop in the message box to insert a branch reference", { exact: true })).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`${target}$`))
  expect(admissions).toEqual([])
  await page.mouse.up()
  await expect(editor.locator('[data-mention="session"]')).toHaveCount(1)
  await expect(page.locator('[data-component="session-dropzone"][data-visible="true"]')).toHaveCount(0)
  await expect(page).toHaveURL(new RegExp(`${target}$`))
  const first = editor.locator('[data-mention="session"]').filter({ hasText: peers[0].title })
  await expect(first).toHaveAttribute("title", peers[0].id)
  await editor.press("End")
  await editor.pressSequentially(" between ")
  await source(peers[1].id).dragTo(editor)
  const chips = editor.locator('[data-mention="session"]')
  await expect(chips).toHaveCount(2)
  await expect(editor).toContainText("before")
  await expect(editor).toContainText("between")
  expect(admissions).toEqual([])
  await expect.poll(async () => {
    const stored = await storedSessionDraft(page, target)
    return peers.every((peer) => stored.includes(peer.id)) && stored.includes("between")
  }).toBe(true)
  await page.reload()
  await expect(chips).toHaveCount(2)
  await expect(chips.nth(0)).toHaveAttribute("title", peers[0].id)
  await expect(chips.nth(1)).toHaveAttribute("title", peers[1].id)
  await chips.nth(0).getByRole("button", { name: "Remove attachment" }).click()
  await expect(chips).toHaveCount(1)
  await expect(chips).toHaveAttribute("title", peers[1].id)
  await expect(editor).toContainText("between")
  expect(admissions).toEqual([])
  await page.getByRole("button", { name: "Send", exact: true }).click()
  await expect.poll(() => admissions.length).toBe(1)
  expect(admissions[0].sessionID).toBe(target)
  expect(admissions[0].body.text).toContain('"sessionID":"ses_ref_second"')
  expect(admissions[0].body.text).not.toContain("ses_ref_first")
})
}

test("new-session draft distinguishes branch-reference dragging, cancellation and file dragging", async ({ page }) => {
  const peer = "ses_draft_reference_peer"
  const { editor } = await openDraft(page, { name: "DraftReferenceDrag", sessions: [{ id: peer, title: "Draft colleague" }] })
  const source = page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(peer)}"]) [data-session-reference-drag]`)
  const transfer = await page.evaluateHandle(() => new DataTransfer())
  await source.dispatchEvent("dragstart", { dataTransfer: transfer })
  await editor.dispatchEvent("dragenter", { dataTransfer: transfer })
  await expect(page.getByText("Drop in the message box to insert a branch reference", { exact: true })).toBeVisible()
  await source.dispatchEvent("dragend", { dataTransfer: transfer })
  await expect(page.locator('[data-component="session-dropzone"][data-visible="true"]')).toHaveCount(0)
  await expect(editor).toHaveText("")
  await editor.dispatchEvent("dragenter", { dataTransfer: transfer })
  await editor.dispatchEvent("drop", { dataTransfer: transfer })
  await expect(editor.locator('[data-mention="session"]')).toHaveAttribute("title", peer)
  await transfer.dispose()
  const file = await page.evaluateHandle(() => {
    const transfer = new DataTransfer()
    transfer.items.add(new File(["fixture"], "reference-file.txt", { type: "text/plain" }))
    return transfer
  })
  await editor.dispatchEvent("dragover", { dataTransfer: file })
  await expect(page.locator('[data-component="session-dropzone"][data-visible="true"]')).toContainText("Drop files to add")
  await editor.dispatchEvent("drop", { dataTransfer: file })
  await expect(page.locator('[data-component="composer-attachments"]')).toContainText("reference-file.txt")
  await expect(editor.locator('[data-mention="session"]')).toHaveAttribute("title", peer)
  await expect(page.locator('[data-component="session-dropzone"][data-visible="true"]')).toHaveCount(0)
  await file.dispose()
})

test("restored branch history retains its server and cannot silently address an identical ID on another server", async ({ page }) => {
  const local: Parameters<NonNullable<MockServerConfig["onPrompt"]>>[0][] = []
  const remote: Parameters<NonNullable<MockServerConfig["onPrompt"]>>[0][] = []
  const target = "ses_reference_origin"
  const peer = "ses_reference_peer"
  await mockRemoteServer(page, { provider: provider(), sessions: [session({ id: target, title: "Other server", directory: "/remote/project", projectID: "proj_remote" }),
    session({ id: peer, title: "Same title", directory: "/remote/project", projectID: "proj_remote" })], onPrompt: (input) => remote.push(input) })
  const { editor } = await openSession(page, { name: "ReferenceOrigin", sessionID: target,
    sessions: [{ id: target, title: "Origin server" }, { id: peer, title: "Same title" }],
    seed: { tabs: [target, peer, { session: target, server: REMOTE_SERVER }] }, onPrompt: (input) => local.push(input) })
  await editor.fill("Consult ")
  await page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(peer)}"]) [data-session-reference-drag]`).dragTo(editor)
  await expect(editor.locator('[data-mention="session"]')).toHaveAttribute("title", peer)
  await page.getByRole("button", { name: "Send", exact: true }).click()
  await expect.poll(() => local.length).toBe(1)
  expect(local[0].body.metadata).toMatchObject({ sessionReferences: [{ sessionID: peer, server: SERVER }] })
  await expect(editor).toHaveText("")
  await page.locator(`a[data-titlebar-tab-link][href="${sessionHref(target, REMOTE_SERVER)}"]`).click()
  await expect(page).toHaveURL(new RegExp(`${sessionHref(target, REMOTE_SERVER)}$`))
  await expect(editor).toBeEditable()
  await editor.press("ArrowUp")
  await expect(editor.locator('[data-mention="session"]')).toHaveAttribute("title", peer)
  await page.getByRole("button", { name: "Send", exact: true }).click()
  await expect(page.getByText("Branch reference belongs to another server", { exact: true })).toBeVisible()
  expect(remote).toEqual([])
  await expect(editor.locator('[data-mention="session"]')).toHaveAttribute("title", peer)
  await editor.locator('[data-mention="session"]').getByRole("button", { name: "Remove attachment" }).click()
  await page.getByRole("button", { name: "Send", exact: true }).click()
  await expect.poll(() => remote.length).toBe(1)
  expect(remote[0].body.text).not.toContain(peer)
})

test("adds, persists, edits, removes and submits chat quotes with source details", async ({ page }) => {
  const quote = {
    sessionID: "ses_quotes",
    messageID: "msg_answer",
    userMessageID: "msg_question",
    partID: "msg_answer:text:0",
    text: "quoted answer",
    start: 4,
    end: 17,
    before: "The ",
    after: " is here.\n",
    number: 1,
  }

  const messages: SessionMessageInfo[] = [
    { id: "msg_question", type: "user", text: "A question", time: { created: T0 } },
    {
      id: "msg_answer",
      type: "assistant",
      agent: "build",
      model: { providerID: "opencode", id: "claude-opus-4-6" },
      content: [{ type: "text", text: "The **quoted answer** is here." }],
      time: { created: T0 + 1, completed: T0 + 2 },
    },
    {
      id: "msg_sent",
      type: "user",
      text: "An earlier comment",
      time: { created: T0 + 3 },
      metadata: {
        displayText: "An earlier comment",
        comments: [
          {
            type: "note",
            origin: "message",
            label: "Quote 1",
            icon: "comment",
            subject: "message msg_answer",
            comment: "Already submitted",
            quote,
          },
        ],
      },
    },
  ]

  const admissions: Parameters<NonNullable<MockServerConfig["onPrompt"]>>[0][] = []
  const history = Promise.withResolvers<void>()
  await openSession(page, {
    name: "MessageQuotes",
    sessions: [{ id: "ses_quotes" }],
    pageMessages: (_, __, before) =>
      before ? { items: messages.slice(0, 2) } : { items: messages.slice(2), cursor: "msg_sent" },
    beforeMessagesResponse: (input) => (input.before ? history.promise : Promise.resolve()),
    onPrompt: (input) => admissions.push(input),
  })

  const body = page.locator('[data-timeline-part-id="msg_answer:text:0"] [data-slot="text-part-body"]')
  const editor = page.locator('[data-component="composer-editor"]')

  const sent = page
    .locator('[data-component="user-message"] [data-component="attachment-card"]')
    .filter({ hasText: "Already submitted" })

  await sent.click()
  const details = page.getByRole("dialog")
  await expect(details.getByText("quoted answer", { exact: true })).toBeVisible()
  await expect(details.getByText("Already submitted", { exact: true })).toBeVisible()
  await details.getByRole("button", { name: "Go to source" }).click()
  await expect(page).toHaveURL(/#message-msg_question$/)
  history.resolve()
  await expect(details).toHaveCount(0)
  await expect(page.locator("[data-dialog-layer]")).toHaveCount(0)
  await expect(body).toContainText("The quoted answer is here.")

  await body.locator("strong").evaluate((element) => {
    const selection = window.getSelection()
    const range = document.createRange()

    range.selectNodeContents(element)
    selection?.removeAllRanges()
    selection?.addRange(range)
  })
  // Playwright cannot enable Chromium caret browsing, so establish the static-text range above and use a trusted
  // keyboard event here to exercise the keyboard path instead of dispatching a synthetic KeyboardEvent.
  await page.keyboard.press("Shift")
  await expect(page.getByRole("button", { name: "Add comment", exact: true })).toBeFocused()
  await page.evaluate(() => window.getSelection()?.removeAllRanges())
  await body.click()
  await expect(page.locator('[data-component="message-quote-popover"]')).toHaveCount(0)

  const select = async () => {
    const box = await body.locator("strong").boundingBox()

    if (!box) throw new Error("Missing quote source bounds")

    await page.mouse.move(box.x + 1, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 5 })
    await page.mouse.up()
    await expect(page.locator('[data-component="message-quote-popover"]')).toBeVisible()
    await page.getByRole("button", { name: "Add comment", exact: true }).click()
  }

  await select()
  const comment = page.getByRole("textbox", { name: "Comment on this quote" })
  await comment.fill("Draft explanation")
  await expect(comment).toBeFocused()
  await page.screenshot({ path: test.info().outputPath("quote-editor.png") })
  await comment.press("Shift+Enter")
  await expect(comment).toHaveValue("Draft explanation\n")
  await comment.press("Escape")
  await expect(page.locator('[data-slot="composer-attachments-scroll"]')).toHaveCount(0)
  await expect(editor).toBeFocused()
  await select()
  await comment.fill("Draft explanation")
  await comment.press("Enter")
  await expect(editor).toBeFocused()
  const drafts = page.locator('[data-slot="composer-attachments-scroll"]')
  await expect(drafts.getByText("Draft explanation", { exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath("quote-draft.png") })
  await expect.poll(() => storedSessionDraft(page, "ses_quotes")).toContain("Draft explanation")
  const stored = await storedSessionDraft(page, "ses_quotes")
  await page.reload()
  await expect(drafts.getByText("Draft explanation", { exact: true })).toBeVisible()
  expect(stored).toContain('"sessionID":"ses_quotes"')
  expect(stored).toContain('"messageID":"msg_answer"')
  expect(stored).toContain('"userMessageID":"msg_question"')
  expect(stored).toContain('"partID":"msg_answer:text:0"')
  expect(stored).toContain('"text":"quoted answer"')
  expect(stored).toContain('"start":4')
  expect(stored).toContain('"end":17')
  expect(stored).toContain('"before":"The "')
  expect(stored).toContain('"after":" is here.\\n"')
  await drafts.getByRole("button", { name: "Draft explanation", exact: true }).click()
  await comment.fill("Edited explanation")
  await comment.press("Enter")
  await expect(drafts.getByText("Edited explanation", { exact: true })).toBeVisible()
  await expect.poll(() => storedSessionDraft(page, "ses_quotes")).toContain("Edited explanation")
  await expect.poll(() => storedSessionDraft(page, "ses_quotes")).not.toContain("Draft explanation")
  await drafts.getByRole("button", { name: "Remove attachment", exact: true }).click()
  await expect(drafts).toHaveCount(0)
  await expect.poll(() => storedSessionDraft(page, "ses_quotes")).toContain('"items":[]')
  await page.reload()
  await expect(drafts).toHaveCount(0)
  await select()
  await comment.fill("Final explanation")
  await comment.press("Enter")
  await expect(editor).toBeFocused()
  await expect.poll(() => storedSessionDraft(page, "ses_quotes")).toContain("Final explanation")
  await page.reload()
  await expect(drafts.getByText("Final explanation", { exact: true })).toBeVisible()
  await expect(drafts.locator('[data-component="attachment-card"]')).toHaveCount(1)
  await editor.click()
  await editor.press("Enter")
  await expect.poll(() => admissions.length).toBe(1)
  const finalQuote = quote

  expect(admissions[0]?.sessionID).toBe("ses_quotes")
  expect(admissions[0]?.body.metadata).toMatchObject({
    comments: [
      expect.objectContaining({ type: "note", origin: "message", comment: "Final explanation", quote: finalQuote }),
    ],
  })
  expect(admissions[0]?.body.text).toEqual(expect.stringContaining(JSON.stringify(finalQuote.text)))
  expect(admissions[0]?.body.text).toEqual(
    expect.stringContaining(
      JSON.stringify({ sessionID: finalQuote.sessionID, messageID: finalQuote.messageID, partID: finalQuote.partID }),
    ),
  )
  expect(admissions[0]?.body.text).toEqual(expect.stringContaining("Final explanation"))
  await expect(drafts).toHaveCount(0)
})

async function draft(page: Page) {
  const { editor } = await openDraft(page, { name: "ComposerDraft", provider: NO_PROVIDER })
  await editor.click()

  return editor
}

async function expectCaretVisible(input: Locator) {
  await expect
    .poll(() =>
      input.evaluate((element) => {
        const selection = window.getSelection()

        if (!selection?.isCollapsed || !selection.rangeCount || !element.contains(selection.anchorNode)) return false
        const caret = selection.getRangeAt(0).getBoundingClientRect()
        const viewport = (element.closest("[data-scrollable]") ?? element).getBoundingClientRect()

        return caret.height > 0 && caret.top >= viewport.top - 1 && caret.bottom <= viewport.bottom + 1
      }),
    )
    .toBe(true)
}

test("keeps a 25000-line crash report editable in a new session", async ({ page }) => {
  const input = await draft(page)
  const text = "Thread 0 Crashed:\n" + "0   Example  0x0000000100000000 frame + 32\n".repeat(25000) + "End of report"
  await page.evaluate((text) => navigator.clipboard.writeText(text), text)

  const events = await input.evaluateHandle((element) => {
    const events = { count: 0 }
    element.addEventListener("input", () => events.count++)

    return events
  })

  await page.keyboard.press("ControlOrMeta+V")
  await expect.poll(async () => (await input.innerText()) === text).toBe(true)
  expect(await events.evaluate((events) => events.count)).toBe(1)
  await expect(input).toBeFocused()
  await expectCaretVisible(input)
  const scroll = page.locator('[data-component="composer-scroll"]')
  await expect(scroll.locator(".scroll-view__viewport")).toHaveCSS("scrollbar-width", "none")
  await expect(scroll.locator(".scroll-view__thumb")).toBeVisible()
  await page.keyboard.type("!")
  await expect.poll(async () => (await input.innerText()) === text + "!").toBe(true)
  await expectCaretVisible(input)
  const thumb = await scroll.locator(".scroll-view__thumb").boundingBox()
  const bounds = await scroll.boundingBox()

  if (!thumb || !bounds) throw new Error("Missing composer scrollbar bounds")
  await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2)
  await page.mouse.down()
  await page.mouse.move(thumb.x + thumb.width / 2, bounds.y + 8 + thumb.height / 2)
  await page.mouse.up()
  await expect(scroll.locator(".scroll-view__viewport")).toHaveJSProperty("scrollTop", 0)
  await expect(input).toBeFocused()
  await page.keyboard.press("ControlOrMeta+Home")
  await page.keyboard.press("ControlOrMeta+End")
  await expectCaretVisible(input)
})

test("a key-up never moves the caret back after later navigation", async ({ page }) => {
  const input = await draft(page)
  await input.pressSequentially("first line")
  await expect(input).toHaveText("first line")

  // Navigation can land before the next frame; the cursor a key-up recorded must not overwrite it there.
  const offset = await input.evaluate(async (element) => {
    const text = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode()!
    const selection = window.getSelection()!
    selection.collapse(text, 0)
    element.dispatchEvent(new KeyboardEvent("keyup", { key: "Home", bubbles: true }))
    selection.collapse(text, text.textContent!.length)
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

    return selection.anchorOffset
  })

  expect(offset).toBe("first line".length)
})

for (const [width, direction] of [
  [390, "rtl"],
  [1280, "ltr"],
] as const) {
  test(`reveals a multiline paste in the middle at ${width}px in ${direction}`, async ({ page }) => {
    const input = await draft(page)
    await page.setViewportSize({ width, height: 800 })
    await page.evaluate((direction) => (document.documentElement.dir = direction), direction)
    const suffix = "\nExisting trailing content".repeat(100)
    await input.fill("Before " + suffix)
    await input.press("ControlOrMeta+Home")
    await input.press("ArrowRight")
    const text = "Pasted line /tmp/example.ts 123 \u0645\u0631\u062d\u0628\u0627\n".repeat(100) + "End of paste"
    await page.evaluate((text) => navigator.clipboard.writeText(text), text)
    await page.keyboard.press("ControlOrMeta+V")
    await expect.poll(() => input.innerText()).toBe("B" + text + "efore " + suffix)
    await expectCaretVisible(input)
    await page.keyboard.type("!")
    await expect.poll(() => input.innerText()).toBe("B" + text + "!efore " + suffix)
    await expectCaretVisible(input)
  })
}

test("pastes plain text without markup and keeps native undo", async ({ page }) => {
  const input = await draft(page)

  for (const text of [
    "single line <b> &amp;",
    "first\nsecond",
    "\n\n  indented\ttext  \n\nlast\n\n",
    'literal <b>bold</b> &amp; & < > "quotes"\n<script>not code</script>\n<img src="example">',
    "first\r\nsecond\rthird",
  ]) {
    await page.evaluate((text) => navigator.clipboard.writeText(text), text)
    await page.keyboard.press("ControlOrMeta+V")
    const expected = text.replace(/\r\n?/g, "\n")
    await expect.poll(() => input.innerText()).toBe(expected)
    await expect(input.locator("b, script, img")).toHaveCount(0)
    await page.keyboard.press("ControlOrMeta+Z")
    await expect(input).toBeEmpty()
    await page.keyboard.press("ControlOrMeta+Shift+Z")
    await expect.poll(() => input.innerText()).toBe(expected)
    await page.keyboard.press("ControlOrMeta+Z")
    await expect(input).toBeEmpty()
  }
})

test("replaces only the selected text and leaves the caret after the paste", async ({ page }) => {
  const input = await draft(page)
  await page.evaluate(() => navigator.clipboard.writeText("one\ntwo"))
  await page.keyboard.type("before replace after")
  await expect(input).toHaveText("before replace after")
  await page.evaluate(() => document.fonts.ready)

  const word = await input.evaluate((element) => {
    const range = document.createRange()
    range.setStart(element.firstChild!, 7)
    range.setEnd(element.firstChild!, 14)
    const rect = range.getBoundingClientRect()

    return { x: rect.x, y: rect.y + rect.height / 2, width: rect.width }
  })

  await page.mouse.move(word.x, word.y)
  await page.mouse.down()
  await page.mouse.move(word.x + word.width, word.y, { steps: 5 })
  await page.mouse.up()
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("replace")
  await page.keyboard.press("ControlOrMeta+V")
  await expect.poll(() => input.innerText()).toBe("before one\ntwo after")
  await page.keyboard.press("ControlOrMeta+Z")
  await expect(input).toHaveText("before replace after")
  await page.keyboard.press("ControlOrMeta+Shift+Z")
  await expect.poll(() => input.innerText()).toBe("before one\ntwo after")
  await page.keyboard.type("!")
  await expect.poll(() => input.innerText()).toBe("before one\ntwo! after")
})

test("shows the dropzone and attaches a dropped file", async ({ page }) => {
  const writes: { path: string; directory: string; body: string }[] = []
  await openDraft(page, {
    name: "ComposerDraft",
    provider: NO_PROVIDER,
    onFileWrite: (write) => void writes.push(write),
  })
  const surface = page.locator('[data-component="new-session"]')
  const dropzone = page.locator('[data-component="session-dropzone"]')

  const transfer = await page.evaluateHandle(() => {
    const value = new DataTransfer()
    value.items.add(new File(["Dropzone fixture"], "dropzone.txt", { type: "text/plain" }))

    return value
  })

  await expect(dropzone).toHaveCount(0)
  await surface.dispatchEvent("dragover", { dataTransfer: transfer })
  await expect(dropzone).toHaveAttribute("data-visible", "true")
  await expect(dropzone).toContainText("Drop files to add")

  await surface.dispatchEvent("drop", { dataTransfer: transfer })
  await expect(page.locator('[data-component="composer-attachments"]')).toContainText("dropzone.txt")
  await expect(dropzone).toHaveCount(0)
  // The file is uploaded to its own directory in the server's temporary directory, then attached by path.
  await expect
    .poll(() => writes)
    .toEqual([
      {
        path: expect.stringMatching(/\/uploads\/[0-9a-f-]{36}\/dropzone\.txt$/),
        directory: "C:/OpenCode/ComposerDraft",
        body: "Dropzone fixture",
      },
    ])
  await expect(page.locator('[data-component="upload-progress"]')).toHaveCount(0)
  await expect(page.locator('[data-component="composer-attachments"]')).toContainText("dropzone.txt")
})

test("keeps a narrow session composer contained when invoking a built-in", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 })
  const { editor } = await openSession(page, { name: "ComposerCommand", provider: NO_PROVIDER })
  const composer = page.locator('[data-component="composer"]')
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

  await editor.fill("keep me")
  await composer.getByRole("button", { name: "Add images and files" }).click()
  await page.getByRole("menuitem", { name: "Commands" }).click()
  await page.locator('[data-suggestion-id="model.choose"]').click()

  await expect(editor).toHaveText("keep me")
})

test("lists slash commands in their built-in order", async ({ page }) => {
  const { editor } = await openSession(page, {
    name: "ComposerSlash",
    provider: NO_PROVIDER,
    commands: [
      { name: "init", description: "Create AGENTS.md" },
      { name: "review", description: "Review changes" },
    ],
    // A sent message enables /undo, /compact and /fork.
    pageMessages: () => ({ items: [{ id: "msg_slash", type: "user", text: "Hello", time: { created: T0 } }] }),
  })

  await editor.fill("/")
  await expect(page.locator('[data-component="composer-suggestions"] [data-suggestion-id] bdi')).toHaveText([
    "/init",
    "/review",
    "/new",
    "/undo",
    "/compact",
    "/fork",
    "/export",
    "/open",
    "/terminal",
    "/mcp",
    "/model",
    "/connect",
    "/btw",
  ])
})

const followUp = "Add follow-up, / for commands, @ for context…"

for (const row of [
  { state: "an idle", copy: "Ask anything, / for commands, @ for context…" },
  { state: "a running", copy: followUp, sessionStatus: { ses_placeholder: { type: "running" } } },
  {
    state: "an idle queued",
    copy: followUp,
    inbox: [
      {
        id: "inb_placeholder",
        sessionID: "ses_placeholder",
        time: { created: T0 },
        type: "user",
        payload: { text: "Queued follow-up" },
        delivery: "queue",
      },
    ],
  },
]) {
  test(`shows the placeholder for ${row.state} session and the shell example in shell mode`, async ({ page }) => {
    const { editor } = await openSession(page, {
      name: "ComposerPlaceholder",
      sessions: [{ id: "ses_placeholder", title: "Placeholder" }],
      sessionStatus: row.sessionStatus,
      inbox: row.inbox,
    })

    const scroll = page.locator('[data-component="composer-scroll"]')
    await expect(scroll).toHaveText(row.copy)
    await editor.pressSequentially("!")
    await expect(scroll).toHaveText("Enter shell command… git status")
  })
}

test("shows thinking on hover or a non-default selection while preserving keyboard access", async ({ page }) => {
  const { editor: input } = await openSession(page, {
    name: "ComposerThinking",
    provider: provider({ id: "thinking-model", name: "Thinking Model", variants: { high: {} } }),
  })

  const composer = page.locator('[data-component="composer"]')
  const control = composer.getByRole("button", { name: "Choose model variant" })
  const option = (name: string) => page.getByRole("menuitemradio", { name, exact: true })

  await page.mouse.move(0, 0)
  await expect(control).toHaveText("default")
  await expect(control).toHaveCSS("opacity", "0")
  await expect(control).toHaveCSS("pointer-events", "none")

  await input.hover()
  await expect(control).toHaveCSS("opacity", "1")

  // The menu keeps the control visible after the pointer leaves.
  await control.click()
  await expect(option("high")).toBeVisible()
  await page.mouse.move(0, 0)
  await expect(control).toHaveAttribute("aria-expanded", "true")
  await expect(control).toHaveCSS("opacity", "1")
  await option("high").click()

  await input.click()
  await page.mouse.move(0, 0)
  await expect(control).toHaveText("high")
  await expect(control).toHaveCSS("opacity", "1")

  await control.click()
  await option("default").click()
  await input.click()
  await page.mouse.move(0, 0)
  await expect(control).toHaveText("default")
  await expect(control).toHaveCSS("opacity", "0")

  // The single-agent fixture has only Add and Model before the thinking trigger.
  await page.keyboard.press("Tab")
  await expect(composer.getByRole("button", { name: "Add images and files" })).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(composer.getByRole("button", { name: "Thinking Model" })).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(control).toBeFocused()
  await expect(control).toHaveCSS("opacity", "1")
  await page.keyboard.press("Enter")
  await expect(option("default")).toBeFocused()
  await expect(control).toHaveCSS("opacity", "1")
  await page.keyboard.press("Escape")
  await expect(control).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(control).toHaveCSS("opacity", "0")
})
