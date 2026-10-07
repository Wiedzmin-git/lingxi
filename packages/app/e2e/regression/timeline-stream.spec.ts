import { expect, test, type Page } from "@playwright/test"
import type { SessionMessageAssistant, SessionMessageInfo, ShellInfo } from "@opencode/client/promise"
import { timelinePresets } from "@opencode/session-ui/timeline/detail"
import { createTwoFilesPatch } from "diff"
import {
  assistantID,
  assistantMessage,
  compactionDelta,
  compactionEnded,
  compactionFailed,
  compactionStarted,
  completedAssistantInfo,
  directory,
  messageUpdated,
  partUpdated,
  partDelta,
  reasoningPart,
  renderedPartID,
  session,
  sessionID,
  setupTimeline,
  shell,
  status,
  stepStarted,
  stepStreamed,
  textPart,
  toolPart,
  userMessage,
  userText,
} from "../utils/timeline"

const detailed = timelinePresets[2].value

const user = { id: "msg_user", type: "user", text: "Run it", time: { created: 1 } } satisfies SessionMessageInfo

const completed = {
  id: "msg_assistant",
  type: "assistant",
  agent: "build",
  model: { id: "model", providerID: "provider" },
  content: [{ type: "text", text: "Working" }],
  time: { created: 2, completed: 3 },
} satisfies SessionMessageAssistant

test("reanchors quoted text after streamed Markdown changes in both text directions", async ({ page }) => {
  const textID = "prt_quoted_text"

  const quote = {
    sessionID,
    messageID: assistantID,
    userMessageID: "msg_1000_timeline_user",
    partID: `${assistantID}:text:0`,
    text: "same quote",
    start: "Earlier same quote. Target ".length,
    end: "Earlier same quote. Target same quote".length,
    before: "Earlier same quote. Target ",
    after: " after.",
    number: 1,
  }

  const annotation = userMessage([userText("Explain that passage")], {
    id: "msg_2000_annotation",
    created: 1700000002000,
  })

  annotation.metadata = {
    displayText: "Explain that passage",
    comments: [
      {
        type: "note",
        origin: "message",
        icon: "comment",
        label: "Quote 1",
        subject: "a message",
        comment: "Clarify this",
        quote,
      },
      {
        type: "note",
        origin: "message",
        icon: "comment",
        label: "Quote 1",
        subject: "a message",
        comment: "Compare this too",
        quote,
      },
    ],
  }

  const timeline = await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([textPart(textID, "Earlier same quote. Target **same quote** after.")], { completed: false }),
      annotation,
    ],
  })

  const body = page.locator(`[data-timeline-part-id="${quote.partID}"] [data-slot="text-part-body"]`)
  const marker = page.locator('[data-component="message-quote-marker"]')
  const markdown = body.locator('[data-component="markdown"]')

  await expect(marker).toHaveCount(2)
  await expect(page.getByRole("button", { name: "Quote 1: same quote — Clarify this" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Quote 1: same quote — Compare this too" })).toBeVisible()
  expect(
    await marker.evaluateAll((elements) => {
      const [first, second] = elements.map((element) => element.getBoundingClientRect())

      return !!first && !!second && first.bottom <= second.top
    }),
  ).toBe(true)

  await page.evaluate(() => {
    document.documentElement.dir = "ltr"
  })

  for (const direction of ["ltr", "rtl"] as const) {
    await timeline.send(
      partUpdated(
        textPart(
          textID,
          `${direction === "rtl" ? "مرحبا بالعالم. " : "New introduction. "}Earlier same quote. Target _same quote_ after. ${direction}`,
        ),
      ),
    )
    await expect(body).toContainText(`after. ${direction}`)
    await expect(markdown).toHaveCSS("direction", direction)
    await expect
      .poll(() =>
        body.evaluate((element) => {
          const highlight = CSS.highlights.get("message-quotes")
          const range = highlight ? Array.from(highlight)[0] : undefined

          if (!(range instanceof Range) || !element.contains(range.startContainer)) return undefined
          const prefix = range.cloneRange()

          prefix.selectNodeContents(element)
          prefix.setEnd(range.startContainer, range.startOffset)

          return { text: range.toString(), prefix: prefix.toString().endsWith("Earlier same quote. Target ") }
        }),
      )
      .toEqual({ text: "same quote", prefix: true })
    await expect(marker.first()).toBeVisible()
    await expect
      .poll(async () => {
        const rect = await marker.first().boundingBox()
        const quoteRect = await body.locator("em").boundingBox()

        if (!rect || !quoteRect) return false

        return direction === "rtl" ? rect.x + rect.width <= quoteRect.x : rect.x >= quoteRect.x + quoteRect.width
      })
      .toBe(true)
  }

  const beforeReflow = await page.locator('[data-component="message-quote-marker-group"]').boundingBox()
  const quoteBodyHeight = await body.evaluate((element) => element.getBoundingClientRect().height)

  await page
    .locator('[data-message-id="msg_1000_timeline_user"] [data-component="user-message"]')
    .evaluate((element) => {
      element.style.marginBottom = "120px"
    })
  await expect
    .poll(async () => {
      const after = await page.locator('[data-component="message-quote-marker-group"]').boundingBox()

      return beforeReflow && after ? after.y - beforeReflow.y : 0
    })
    .toBeGreaterThan(80)
  expect(await body.evaluate((element) => element.getBoundingClientRect().height)).toBe(quoteBodyHeight)
})

test.describe("static projection", () => {
  test("shows persisted date/time before messages without changing their text", async ({ page }, testInfo) => {
    // No existing keeper checks a display-only timestamp or its stable identity.
    await setupTimeline(page, {
      messages: [
        userMessage([userText("Original user text")]),
        assistantMessage([textPart("prt_original", "Original assistant text")]),
      ],
    })
    const userRow = page.locator('[data-timeline-row="UserMessage"]')
    const assistantRow = page.locator('[data-timeline-row="AssistantPart"]', { hasText: "Original assistant text" })
    for (const [row, iso] of [
      [userRow, "2023-11-14T22:13:20.000Z"],
      [assistantRow, "2023-11-14T22:13:21.000Z"],
    ] as const) {
      const stamp = row.getByLabel("Message date and time")
      await expect(stamp).toBeVisible()
      await expect(stamp).toHaveAttribute("datetime", iso)
      await expect(stamp).toHaveText(/\d.*\d/)
    }
    await expect(userRow.locator('[data-slot="user-message-text"]')).toHaveText("Original user text")
    await expect(assistantRow.locator('[data-component="markdown"]')).toHaveText("Original assistant text")
    expect(
      await assistantRow.evaluate((row) => {
        const stamp = row.querySelector("time")!
        const text = row.querySelector('[data-component="markdown"]')!
        return !!(stamp.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING)
      }),
    ).toBe(true)
    for (const row of [userRow, assistantRow]) {
      expect(
        await row.evaluate((row) => {
          const stamp = row.querySelector("time")!.getBoundingClientRect()
          const body = row
            .querySelector('[data-slot="user-message-text"], [data-component="markdown"]')!
            .getBoundingClientRect()
          return stamp.bottom <= body.top && body.top - stamp.bottom <= 8
        }),
      ).toBe(true)
    }
    await page.screenshot({ path: testInfo.outputPath("chat-timestamps.png") })
    await page.reload()
    await expect(userRow.getByLabel("Message date and time")).toHaveAttribute("datetime", "2023-11-14T22:13:20.000Z")
    await page.keyboard.press("Control+,")
    const settings = page.getByTestId("settings-screen")
    await settings.getByRole("tab", { name: "Appearance", exact: true }).click()
    await settings.getByRole("switch", { name: "Message date and time", exact: true }).press("Space")
    await settings.getByRole("button", { name: "Back to app", exact: true }).click()
    await expect(userRow.getByLabel("Message date and time")).toHaveCount(0)
    await expect(userRow.locator('[data-slot="user-message-meta-tail"]')).toBeAttached()
  })

  test("speed indicator distinguishes live estimates, tool waiting and final usage", async ({ page }, testInfo) => {
    const timeline = await setupTimeline(page, { messages: [userMessage()] })
    const meter = page.getByRole("status", { name: "Generation speed" })
    await expect(meter).toHaveCount(0)
    await page.clock.setFixedTime(new Date("2026-10-06T06:00:00Z"))
    await timeline.send(stepStarted(assistantMessage()))
    await timeline.send(partUpdated(textPart("prt_speed", "")))
    await timeline.send(partDelta("prt_speed", "Live generation"))
    await expect(meter).toHaveText(/^≈ .*tok\/s$/)
    await expect(meter).toHaveAttribute("title", /Estimated streamed text and visible reasoning/)
    await page.clock.setFixedTime(new Date("2026-10-06T06:00:01Z"))
    await expect(meter).toHaveText(/^≈ \d.*tok\/s$/)
    // The message is still streaming: timestamps must not wait for completion.
    const stamp = page
      .locator('[data-timeline-row="AssistantPart"]', { hasText: "Live generation" })
      .getByLabel("Message date and time")
    await expect(stamp).toBeVisible()
    await expect(stamp).toHaveAttribute("datetime", "2023-11-14T22:13:21.000Z")
    await page.screenshot({ path: testInfo.outputPath("live-speed.png") })
    await timeline.send(stepStreamed())
    await expect(meter).toHaveCount(0)
    await timeline.send(messageUpdated(completedAssistantInfo(assistantMessage())))
    await expect(meter).toHaveText(/tok\/s · request avg$/)
    await expect(meter).toHaveAttribute(
      "title",
      /Includes initial model waiting and all reported output; excludes tool waits after the stream/,
    )
    await expect(stamp).toHaveAttribute("datetime", "2023-11-14T22:13:21.000Z")
    await timeline.send(stepStarted(assistantMessage([], { id: "msg_new_step" })))
    await expect(meter).toHaveCount(0)
  })

  test("renders current protocol notices in CLI order", async ({ page }) => {
    const ownerWarnings: string[] = []
    page.on("console", (message) => {
      if (message.text().includes("computations created outside a `createRoot` or `render`"))
        ownerWarnings.push(message.text())
    })
    await setupTimeline(page, {
      settings: { timelineDetail: { ...detailed, notices: { placement: "separate" } } },
      sessionMessages: [
        user,
        { id: "msg_agent", type: "agent-switched", agent: "explore", time: { created: 2 } },
        completed,
        {
          id: "msg_subagent",
          type: "synthetic",
          text: "done",
          description: "Search code",
          metadata: { source: "subagent", agent: "explore", state: "completed" },
          time: { created: 4 },
        },
        {
          id: "msg_restart",
          type: "synthetic",
          text: "continue",
          description: "Continuing after restart",
          time: { created: 5 },
        },
        { id: "msg_skill", type: "skill", skill: "review", name: "Review", text: "instructions", time: { created: 6 } },
      ],
    })

    const notices = page.locator('[data-slot="session-timeline-notice"]')
    await expect(notices).toHaveCount(4)
    await expect(notices.nth(0)).toHaveText(/^Agent changed\s*Explore$/)
    await expect(notices.nth(1)).toContainText("explore finished · Search code")
    await expect(notices.nth(2)).toContainText("Continuing after restart")
    await expect(notices.nth(3)).toContainText("Skill · Review")
    await expect(notices).toHaveClass([/text-text-weak/, /text-text-weak/, /text-text-weak/, /text-text-weak/])
    await expect(notices.locator(".text-text-strong")).toHaveCount(0)
    expect(ownerWarnings).toEqual([])
  })

  test("projects gaps, dividers, assistant parts, and errors together", async ({ page }) => {
    const firstUser = userMessage(
      [
        userText("Keep this stable", { id: "prt_comment" }),
        userText("Continue after the comment", { id: "prt_visible_user" }),
      ],
      { summary: { diffs: Array.from({ length: 11 }, (_, index) => summaryDiff(index)) } },
    )

    const aborted = assistantMessage([{ id: "prt_before_abort", type: "text", text: "Before interruption" }], {
      id: "msg_1001_assistant_aborted",
      error: { type: "MessageAbortedError", message: "Stopped" },
    })

    const failed = assistantMessage([{ id: "prt_after_abort", type: "text", text: "After interruption" }], {
      id: "msg_1002_assistant_failed",
      error: { type: "APIError", message: "Visible provider failure" },
      created: 1700000003000,
    })

    const nextUser = userMessage([userText("Second turn", { id: "prt_second_user" })], {
      id: "msg_2000_second_user",
      created: 1700000005000,
    })

    const nextAssistant = assistantMessage([{ id: "prt_second_text", type: "text", text: "Second response" }], {
      id: "msg_2001_second_assistant",
      parentID: "msg_2000_second_user",
      created: 1700000006000,
    })

    const timeline = await setupTimeline(page, {
      settings: { timelineDetail: detailed },
      messages: [firstUser, aborted, failed, nextUser, nextAssistant],
    })

    await timeline.send(status("idle"))
    const scroller = page.locator(".scroll-view__viewport", { has: page.locator("[data-timeline-row]") })
    await scroller.evaluate((element) => (element.scrollTop = 0))

    await expect(page.locator('[data-timeline-row="TurnDivider"]')).toHaveCount(1)
    await expect(page.getByText("Before interruption", { exact: true })).toBeVisible()
    await expect(page.getByText("Visible provider failure")).toBeVisible()
    await scroller.evaluate((element) => (element.scrollTop = element.scrollHeight))
    await expect(page.locator('[data-timeline-row="TurnGap"]')).toBeVisible()
  })

  test("does not repeat a review comment file as an attachment", async ({ page }) => {
    const message = userMessage([
      userText("what's goin on here", { id: "prt_user_review_comment" }),
      {
        id: "prt_user_review_file",
        type: "file",
        mime: "text/plain",
        filename: "LiveRuntime.ts",
        url: "file:///repo/LiveRuntime.ts?start=14&end=32",
      },
      {
        id: "prt_user_unrelated_file",
        type: "file",
        mime: "text/plain",
        filename: "notes.txt",
        url: "data:text/plain;base64,bm90ZXM=",
      },
    ])

    message.metadata = {
      displayText: "what's goin on here",
      comments: [
        {
          path: "LiveRuntime.ts",
          comment: "what's goin on here",
          selection: { startLine: 14, startChar: 0, endLine: 32, endChar: 0 },
          origin: "review",
        },
      ],
    }
    await setupTimeline(page, { messages: [message, assistantMessage()] })

    const row = page.locator('[data-component="user-message"]')
    await expect(row.getByText("LiveRuntime.ts:14-32", { exact: true })).toBeVisible()
    const attachments = row.locator('[data-slot="user-message-attachments"]')
    await expect(attachments.getByText("LiveRuntime.ts", { exact: true })).toHaveCount(0)
    await expect(attachments.getByText("notes.txt", { exact: true })).toBeVisible()
  })

  test("groups instruction files loaded by the same read", async ({ page }) => {
    const id = "prt_read_instructions"
    await setupTimeline(page, {
      settings: { timelineDetail: { ...detailed, tools: { placement: "separate" } } },
      messages: [
        userMessage(),
        assistantMessage([
          toolPart(
            id,
            "read",
            "completed",
            { path: "src/a.ts" },
            { metadata: { loaded: ["AGENTS.md", "packages/app/AGENTS.md", "packages/ui/AGENTS.md"] } },
          ),
        ]),
      ],
    })

    const loaded = page.locator(`[data-timeline-part-id="${id}"] [data-component="tool-loaded-item"]`)
    await expect(loaded).toHaveCount(1)
    await expect(loaded).toHaveAttribute(
      "aria-label",
      "Loaded AGENTS.md, packages/app/AGENTS.md, packages/ui/AGENTS.md",
    )
    await expect(loaded.locator('[data-slot="tool-loaded-value"]')).toHaveText(
      "AGENTS.md, packages/app/AGENTS.md, packages/ui/AGENTS.md",
    )
    await expect(loaded.locator('[data-slot="tool-loaded-kind"]')).toHaveCount(0)
  })

  test("groups only consecutive successful skill tools", async ({ page }) => {
    const parts = [
      toolPart("prt_skill_first", "skill", "completed", { id: "ocpr" }),
      toolPart("prt_skill_second", "skill", "completed", { id: "effect" }),
      toolPart("prt_skill_third", "skill", "completed", { id: "ui-pr-screenshots" }),
      toolPart("prt_skill_break", "read", "completed", { path: "src/a.ts" }),
      toolPart("prt_skill_last", "skill", "completed", { id: "opencode" }),
    ]

    await setupTimeline(page, {
      settings: { timelineDetail: detailed },
      messages: [userMessage(), assistantMessage(parts)],
    })

    const group = page.locator(`[data-timeline-part-ids="${parts.map((part) => part.id).join(",")}"]`)
    await group.getByRole("button").click()
    const loaded = group.locator('[data-component="tool-loaded-item"]')
    await expect(loaded).toHaveCount(2)
    await expect(loaded.nth(0)).toHaveAttribute("aria-label", "Loaded ocpr, effect, ui-pr-screenshots skills")
    await expect(loaded.nth(1)).toHaveAttribute("aria-label", "Loaded opencode skill")
  })

  test("leaves tools expanded by settings outside the collapsed stack", async ({ page }) => {
    const parts = [
      shell("prt_expanded_shell", "completed", "expanded"),
      toolPart("prt_collapsed_patch", "patch", "completed", { patchText: "Update src/value.ts" }),
      toolPart("prt_collapsed_read", "read", "completed", { path: "src/value.ts" }),
    ]

    await setupTimeline(page, {
      messages: [userMessage(), assistantMessage(parts)],
      settings: { shellToolPartsExpanded: true },
    })

    await expect(page.locator('[data-timeline-part-id="prt_expanded_shell"]')).toBeVisible()
    const group = page.locator('[data-timeline-part-ids="prt_collapsed_patch,prt_collapsed_read"]')
    await expect(group.getByRole("button", { name: "Used 2 Patch, Read", exact: true })).toBeVisible()
    await expect(group.locator('[data-component="context-tool-group-trigger"]')).toHaveAttribute(
      "aria-label",
      "Used 2 Patch, Read",
    )
    await expect(page.locator('[data-timeline-spacing="tool"]')).toHaveCSS("padding-top", "8px")
  })
})

test("combines adjacent patch calls and repeated files into one group", async ({ page }) => {
  const [first, second] = ["prt_patch_first", "prt_patch_second"]

  const timeline = await setupTimeline(page, {
    settings: { timelineDetail: { ...detailed, edit: { placement: "separate", details: "collapsed" } } },
    messages: [
      userMessage(),
      assistantMessage([
        toolPart(
          first,
          "patch",
          "completed",
          { patchText: "Update src/first.ts" },
          { metadata: { files: [patchFile("src/first.ts", "modified")] } },
        ),
      ]),
    ],
  })

  const initial = page.locator(`[data-timeline-part-id="${first}"]`)
  const initialFile = initial.locator('[data-scope="apply-patch"] [data-type="update"]')
  await expect(initialFile.getByRole("button")).toHaveAttribute("aria-expanded", "false")
  await initialFile.getByRole("button").click()
  await expect(initialFile.getByRole("button")).toHaveAttribute("aria-expanded", "true")
  await initial.evaluate((element) => {
    const row = element.closest<HTMLElement>("[data-timeline-key]")

    if (row) row.dataset.patchRow = "stable"
  })

  await timeline.send(partUpdated(toolPart(second, "patch", "running", { patchText: "Update more files" })))
  const group = page.locator(`[data-timeline-part-ids="${first},${second}"]`)
  const row = group.locator("xpath=ancestor::*[@data-timeline-key]")
  const updated = group.locator('[data-scope="apply-patch"] [data-type="update"] button')
  await expect(row).toHaveAttribute("data-patch-row", "stable")
  await expect(group.locator('[data-slot="apply-patch-filename"]')).toHaveText(["first.ts"])
  await expect(updated).toHaveAttribute("aria-expanded", "true")

  await timeline.send(
    partUpdated(
      toolPart(
        second,
        "patch",
        "completed",
        { patchText: "Update more files" },
        { metadata: { files: [patchFile("src/first.ts", "modified"), patchFile("src/second.ts", "added")] } },
      ),
    ),
  )
  await expect(group.locator('[data-slot="apply-patch-filename"]')).toHaveText(["first.ts", "second.ts"])
  await expect(updated).toHaveAttribute("aria-expanded", "true")
  await expect(group.locator('[data-scope="apply-patch"] [data-type="add"] button')).toHaveAttribute(
    "aria-expanded",
    "false",
  )
  await expect(page.locator(`[data-timeline-part-id="${first}"], [data-timeline-part-id="${second}"]`)).toHaveCount(0)
})

test("keeps a failed patch in Used without losing the surviving file choice", async ({ page }) => {
  const failed = "prt_grouped_patch_failed"
  const surviving = "prt_grouped_patch_surviving"

  const timeline = await setupTimeline(page, {
    settings: { timelineDetail: detailed },
    messages: [
      userMessage(),
      assistantMessage(
        [
          toolPart(failed, "patch", "running", { patchText: "Update src/failed.ts" }),
          toolPart(
            surviving,
            "patch",
            "running",
            { patchText: "Update src/surviving.ts" },
            { metadata: { files: [patchFile("src/surviving.ts", "modified")] } },
          ),
        ],
        { completed: false },
      ),
    ],
  })

  const group = page.locator('[data-component="collapsed-tool-group"]')
  const used = group.locator(':scope > [data-component="collapsible"] > [data-slot="collapsible-trigger"]')
  await used.click()
  const file = group.locator('[data-scope="apply-patch"] button')
  await expect(file).toHaveAttribute("aria-expanded", "false")
  await file.click()
  await expect(file).toHaveAttribute("aria-expanded", "true")
  await group.evaluate((element) => {
    const row = element.closest<HTMLElement>("[data-timeline-key]")

    if (row) row.dataset.groupIdentity = "preserved"
  })

  await timeline.send(
    partUpdated(
      toolPart(failed, "patch", "error", { patchText: "Update src/failed.ts" }, { error: "Patch failed visibly" }),
    ),
  )

  const failedRow = page.locator("[data-timeline-key]", { has: page.locator(`[data-timeline-part-id="${failed}"]`) })

  const survivingRow = page.locator("[data-timeline-key]", {
    has: page.locator(`[data-timeline-part-id="${surviving}"]`),
  })

  await expect(group).toHaveAttribute("data-timeline-part-ids", `${failed},${surviving}`)
  await expect(used).toHaveAttribute("aria-expanded", "true")
  await expect(failedRow).toHaveAttribute("data-timeline-key", /^assistant-part:context:/)
  await expect(survivingRow).toHaveAttribute("data-timeline-key", /^assistant-part:context:/)
  await group.locator(`[data-timeline-part-id="${failed}"] [data-slot="collapsible-trigger"]`).click()
  await expect(failedRow.getByText("Patch failed visibly")).toBeVisible()
  await expect(survivingRow).toHaveAttribute("data-group-identity", "preserved")
  await expect(survivingRow.locator('[data-scope="apply-patch"] button')).toHaveAttribute("aria-expanded", "true")
})

test("does not remount an edit diff when a sibling part arrives", async ({ page }) => {
  const editID = "prt_0001_edit"
  await page.addInitScript(() => {
    let count = 0
    const attachShadow = Element.prototype.attachShadow
    Element.prototype.attachShadow = function (init) {
      count += 1

      return attachShadow.call(this, init)
    }

    // SAFETY: this init script owns `__shadowRoots`; the probe reads below run only after it installed it.
    const probe = window as Window & { __shadowRoots?: { reset(): void; count(): number } }

    probe.__shadowRoots = {
      reset: () => {
        count = 0
      },
      count: () => count,
    }
  })

  const timeline = await setupTimeline(page, {
    settings: { editToolPartsExpanded: true, shellToolPartsExpanded: true, showReasoningSummaries: true },
    messages: [
      userMessage(),
      assistantMessage(
        [
          toolPart(
            editID,
            "edit",
            "completed",
            {
              path: "src/regression.ts",
              oldString: "export const value = 'before'",
              newString: "export const value = 'after'",
            },
            {
              output: "Edited src/regression.ts",
              title: "src/regression.ts",
              metadata: {
                files: [
                  {
                    file: "src/regression.ts",
                    patch: createTwoFilesPatch(
                      "a/src/regression.ts",
                      "b/src/regression.ts",
                      "export const value = 'before'\n",
                      "export const value = 'after'\n",
                    ),
                    additions: 1,
                    deletions: 1,
                    status: "modified",
                  },
                ],
              },
            },
          ),
        ],
        { completed: false },
      ),
    ],
  })

  const tool = page.locator(`[data-timeline-part-id="${editID}"]`)
  await expect(tool.locator('[data-component="file"][data-mode="diff"]')).toBeVisible()

  const markers = () =>
    tool.evaluate((element) => {
      const nodes = [
        element,
        element.querySelector('[data-component="file"][data-mode="diff"]'),
        element.closest("[data-timeline-key]"),
        element.closest("[data-timeline-row]"),
      ]

      return {
        markers: nodes.map((node) => (node instanceof HTMLElement ? node.dataset.timelineProbe : undefined)),
        // SAFETY: the init script installed `__shadowRoots` before the page loaded.
        shadowRoots: (window as Window & { __shadowRoots?: { count(): number } }).__shadowRoots!.count(),
      }
    })

  await tool.evaluate((element) => {
    ;[
      element,
      element.querySelector('[data-component="file"][data-mode="diff"]'),
      element.closest("[data-timeline-key]"),
      element.closest("[data-timeline-row]"),
    ].forEach((node) => {
      if (!(node instanceof HTMLElement)) throw new Error("missing edit tool, diff, row, or frame")
      node.dataset.timelineProbe = "before"
    })

    // SAFETY: the init script installed `__shadowRoots` before the page loaded.
    const probe = window as Window & { __shadowRoots?: { reset(): void } }

    probe.__shadowRoots!.reset()
  })

  await timeline.send(partUpdated(textPart("prt_sibling_text", "Streaming added a later assistant text part.")))
  await timeline.waitForPart("prt_sibling_text")
  expect(await markers()).toEqual({ markers: ["before", "before", "before", "before"], shadowRoots: 0 })
})

for (const transition of ["reasoning-end", "idle", "retry"] as const) {
  test(`stops active Thinking on ${transition} without a following tool`, async ({ page }) => {
    const id = `prt_reasoning_stop_${transition}`
    const text = "## Inspecting stability\n\nThe timeline is ready for the next step."

    const timeline = await setupTimeline(page, {
      messages: [userMessage(), assistantMessage([reasoningPart(id, text)], { completed: false })],
      settings: { timelineDetail: { ...detailed, thinking: { placement: "separate", details: "collapsed" } } },
    })

    const part = page.locator(`[data-timeline-part-id="${renderedPartID(id)}"]`)
    const trigger = part.locator('[data-slot="collapsible-trigger"]')
    await expect(page.locator('[data-timeline-row="Thinking"]')).toBeVisible()
    await expect(trigger).toHaveAttribute("aria-expanded", "false")
    await timeline.send(transition === "reasoning-end" ? partUpdated(reasoningPart(id, text)) : status(transition))
    await expect(trigger).toContainText("Thought")
    await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
    await expect(page.locator('[data-timeline-row="Retry"]')).toHaveCount(transition === "retry" ? 1 : 0)
    await trigger.click()
    await expect(trigger).toHaveAttribute("aria-expanded", "true")
    await expect(part.getByText("The timeline is ready for the next step.", { exact: true })).toBeVisible()
  })
}

// Separate placement keeps each part standalone, so the user's disclosure choice must survive completion.
for (const shellDefault of ["collapsed", "expanded"] as const) {
  test(`keeps separate shell and reasoning disclosure through completion from the ${shellDefault} shell default`, async ({
    page,
  }) => {
    const reasoningID = `prt_separate_reasoning_${shellDefault}`
    const shellID = `prt_separate_shell_${shellDefault}`
    const output = (count: number) => Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n")
    const assistant = assistantMessage([reasoningPart(reasoningID, "## Inspecting stability")], { completed: false })

    const timeline = await setupTimeline(page, {
      messages: [userMessage(), assistant],
      settings: {
        timelineDetail: {
          ...detailed,
          thinking: { placement: "separate", details: "collapsed" },
          shell: { placement: "separate", details: shellDefault },
        },
      },
    })

    const thought = page.locator(
      `[data-timeline-part-id="${renderedPartID(reasoningID)}"] [data-slot="collapsible-trigger"]`,
    )

    const shellTrigger = page.locator(`[data-timeline-part-id="${shellID}"] [data-slot="collapsible-trigger"]`)
    const group = page.locator('[data-component="collapsed-tool-group"]')
    // One row opens the thought, the other opens and then closes it again.
    const thoughtOpen = shellDefault === "collapsed"
    await expect(page.locator('[data-timeline-row="Thinking"]')).toBeVisible()
    await expect(thought).toHaveAttribute("aria-expanded", "false")
    await thought.click()

    if (!thoughtOpen) await thought.click()
    await expect(thought).toHaveAttribute("aria-expanded", String(thoughtOpen))

    await timeline.send(partUpdated(shell(shellID, "running", output(3))))
    await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
    await expect(group).toHaveCount(0)
    await expect(shellTrigger).toHaveAttribute("aria-expanded", String(shellDefault === "expanded"))
    await shellTrigger.click()
    await expect(shellTrigger).toHaveAttribute("aria-expanded", String(shellDefault !== "expanded"))

    await timeline.send(partUpdated(shell(shellID, "completed", output(6))))
    await timeline.send(partUpdated(textPart(`prt_separate_sibling_${shellDefault}`, "Sibling content")))
    await timeline.send(messageUpdated(completedAssistantInfo(assistant)))
    await timeline.send(status("idle"))
    await expect(page.getByText("Sibling content", { exact: true })).toBeVisible()
    await expect(page.locator(`[data-timeline-part-id="${shellID}"] [data-component="text-shimmer"]`)).toHaveAttribute(
      "data-active",
      "false",
    )
    await expect(group).toHaveCount(0)
    await expect(shellTrigger).toHaveAttribute("aria-expanded", String(shellDefault !== "expanded"))
    await expect(thought).toHaveAttribute("aria-expanded", String(thoughtOpen))
  })
}

test.describe("Working", () => {
  test("shows Working between busy and reasoning states", async ({ page }) => {
    const timeline = await setupTimeline(page, {
      messages: [userMessage()],
      sessionStatus: { [sessionID]: { type: "busy" } },
      viewport: { width: 390, height: 900 },
      settings: { timelineDetail: { ...detailed, thinking: { placement: "separate", details: "collapsed" } } },
    })

    const working = page.locator('[data-component="session-working"]')
    const shimmer = working.locator('[data-component="text-shimmer"]')
    await expect(working).toHaveCount(1)
    await expect(working).toHaveRole("status")
    await expect(shimmer).toHaveAttribute("aria-label", "Working")
    await expect(working).toBeInViewport()
    await expect(shimmer).toHaveAttribute("data-active", "true")
    await expect(shimmer).toHaveCSS("line-height", "16px")
    await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)

    await timeline.send(stepStarted(assistantMessage([], { completed: false })))
    await expect(working).toBeVisible()
    await timeline.send(partUpdated(reasoningPart("prt_working_reasoning", "")))
    await expect(page.locator('[data-timeline-row="Thinking"]')).toBeVisible()
    await expect(working).toHaveCount(0)

    await timeline.send(partUpdated(reasoningPart("prt_working_reasoning", "The inspection is complete.")))
    await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
    await expect(shimmer).toHaveAttribute("aria-label", "Working")
    await expect(working).toBeInViewport()

    await timeline.send(status("idle"))
    await expect(working).toHaveCount(0)
  })

  test("keeps Working instead of Used 1 Thought while reasoning is the only activity", async ({ page }) => {
    const timeline = await setupTimeline(page, {
      messages: [
        userMessage(),
        assistantMessage([reasoningPart("prt_only_thought", "Still considering the answer.")], { completed: false }),
      ],
      settings: { timelineDetail: detailed },
    })

    const working = page.locator('[data-component="session-working"]')
    const group = page.locator('[data-component="collapsed-tool-group"]')
    await expect(working).toBeVisible()
    await expect(group).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Used 1 Thought" })).toHaveCount(0)

    await timeline.send(partUpdated(toolPart("prt_after_thought", "read", "running", { filePath: "package.json" })))
    await expect(group).toBeVisible()
    await expect(group).toHaveAttribute("data-timeline-part-ids", `${assistantID}:reasoning:0,prt_after_thought`)
    await expect(working).toBeVisible()
  })

  for (const name of ["shell", "patch", "subagent"] as const) {
    test(`hides Working during ${name} input and execution, then restores it on completion`, async ({ page }) => {
      const timeline = await setupTimeline(page, {
        messages: [userMessage(), assistantMessage([], { completed: false })],
        settings: {
          timelineDetail: { ...timelinePresets[0].value, shell: { placement: "separate", details: "collapsed" } },
        },
      })

      const working = page.locator('[data-component="session-working"]')
      await expect(working).toBeVisible()

      const id = `prt_working_${name}`

      const input = {
        shell: { command: "printf ready" },
        patch: {
          patchText: "*** Begin Patch\n*** Add File: src/working.ts\n+export const ready = true\n*** End Patch",
        },
        subagent: { agent: "general", description: "Inspect working indicator", prompt: "Inspect the timeline." },
      }[name]

      await timeline.send(partUpdated(toolPart(id, name, "streaming", input)))
      const tool = page.locator(`[data-timeline-part-id="${id}"]`)
      await expect(tool).toBeVisible()
      await expect(working).toHaveCount(0)

      const metadata =
        name === "patch"
          ? { files: [{ ...patchFile("src/working.ts", "added"), patch: "@@ -0,0 +1 @@\n+export const ready = true" }] }
          : {}

      await timeline.send(partUpdated(toolPart(id, name, "running", input, { metadata })))
      await expect(tool).toContainText(
        { shell: "printf ready", patch: "working.ts", subagent: "Inspect working indicator" }[name],
      )
      await expect(working).toHaveCount(0)

      await timeline.send(partUpdated(toolPart(id, name, "completed", input, { metadata })))
      await expect(tool).toBeVisible()
      await expect(page.locator('[data-component="collapsed-tool-group"]')).toHaveCount(0)
      await expect(working.locator('[data-component="text-shimmer"]')).toHaveAttribute("aria-label", "Working")
      await expect(working).toBeVisible()
      await expect(working.locator('[data-component="text-shimmer"]')).toHaveAttribute("data-active", "true")
    })
  }

  for (const grouped of [false, true]) {
    test(`uses ${grouped ? "grouped" : "standalone"} background shell presentation`, async ({ page }) => {
      await setupTimeline(page, {
        settings: { shellToolPartsExpanded: !grouped },
        messages: [
          userMessage(),
          assistantMessage(
            [
              toolPart("prt_background_previous", "shell", "completed", { command: "echo ready" }),
              toolPart(
                "prt_background_active",
                "shell",
                "completed",
                { command: "sleep 10" },
                { metadata: { shellID: "sh_working_background", status: "running" } },
              ),
            ],
            { completed: false },
          ),
        ],
      })
      const working = page.locator('[data-component="session-working"]')

      if (!grouped) {
        await expect(page.locator('[data-timeline-part-id="prt_background_active"]')).toBeVisible()
        await expect(working).toHaveCount(0)

        return
      }

      const trigger = page
        .locator('[data-component="collapsed-tool-group"]')
        .getByRole("button", { name: "Used 2 Shell", exact: true, includeHidden: true })

      await expect(trigger).toHaveAttribute("aria-expanded", "false")
      await expect(working).toBeVisible()
      await trigger.click()
      await expect(trigger).toHaveAttribute("aria-expanded", "true")
      await expect(working).toBeVisible()
    })
  }

  test("replaces Working with Retry and restores it on recovery", async ({ page }) => {
    const assistant = assistantMessage([], { completed: false })
    const timeline = await setupTimeline(page, { messages: [userMessage(), assistant] })
    const working = page.locator('[data-component="session-working"]')
    await expect(working).toBeVisible()

    await timeline.send(status("retry"))
    const retry = page.locator('[data-timeline-row="Retry"]')
    await expect(retry).toContainText("Rate limited")
    await expect(working).toHaveCount(0)
    await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)

    await timeline.send(stepStarted(assistant))
    await expect(retry).toHaveCount(0)
    await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
    await expect(working.locator('[data-component="text-shimmer"]')).toHaveAttribute("aria-label", "Working")
    await expect(working).toBeVisible()
  })

  test("hides Working while assistant text streams", async ({ page }) => {
    const timeline = await setupTimeline(page, {
      messages: [userMessage(), assistantMessage([], { completed: false })],
    })

    const working = page.locator('[data-component="session-working"]')
    await expect(working).toBeVisible()

    await timeline.send({
      id: "evt_working_text_started",
      type: "session.text.started",
      created: 1700000002000,
      location: { directory },
      durable: { aggregateID: sessionID, seq: 0, version: 1 },
      data: { sessionID, assistantMessageID: assistantID, ordinal: 0 },
    })
    await timeline.send({
      id: "evt_working_text_delta",
      type: "session.text.delta",
      created: 1700000002001,
      location: { directory },
      data: { sessionID, assistantMessageID: assistantID, ordinal: 0, delta: "The response is streaming." },
    })
    await expect(page.locator(`[data-timeline-part-id="${assistantID}:text:0"]`)).toContainText(
      "The response is streaming.",
    )
    await expect(working).toHaveCount(0)
  })
})

test.describe("background work", () => {
  test("keeps a standalone running subagent visible without a manual background action", async ({ page }) => {
    await setupTimeline(page, {
      settings: { timelineDetail: { ...detailed, subagents: { placement: "separate" } } },
      sessionMessages: [user, runningSubagent()],
    })
    const card = page.locator('[data-component="task-tool-card"]')
    await expect(card).toContainText("Inspect code")
    await expect(card).not.toContainText("(background)")
    await expect(page.getByText("Called `subagent`", { exact: false })).toHaveCount(0)
    await expect(page.locator('[data-component="background-tool-control"]')).toHaveCount(0)
    await expect(backgroundHint(page)).toHaveCount(0)
    await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
    await page.keyboard.press("ControlOrMeta+Shift+P")
    const palette = page.getByRole("dialog")
    await expect(palette.getByRole("textbox")).toBeFocused()
    await expect(palette.getByRole("option")).not.toHaveCount(0)
    await expect(palette.getByRole("option", { name: /Move to background/i })).toHaveCount(0)
    await page.keyboard.press("Escape")
    await expect(palette).toHaveCount(0)
    await expect(card).toContainText("Inspect code")
  })

  for (const name of ["read", "shell", "subagent"] as const) {
    test(`keeps Working and disclosure for a grouped running ${name}`, async ({ page }) => {
      await setupTimeline(page, {
        viewport: { width: name === "shell" ? 390 : 1400, height: 900 },
        settings: { timelineDetail: detailed },
        messages: [
          userMessage(),
          assistantMessage(
            [
              toolPart("prt_grouped_previous", "read", "completed", { filePath: "package.json" }),
              toolPart(
                "prt_grouped_active",
                name,
                "running",
                {
                  read: { filePath: "src/working.ts" },
                  shell: { command: "sleep 10" },
                  subagent: { agent: "general", description: "Inspect the timeline", prompt: "Inspect it." },
                }[name],
              ),
            ],
            { completed: false },
          ),
        ],
      })
      const working = page.locator('[data-component="session-working"]')
      const group = page.locator('[data-timeline-part-ids="prt_grouped_previous,prt_grouped_active"]')
      const trigger = group.locator(':scope > [data-component="collapsible"] > [data-slot="collapsible-trigger"]')
      await expect(trigger).toHaveAttribute("aria-expanded", "false")
      await expect(working).toBeInViewport()

      await expect(backgroundHint(page)).toHaveCount(0)

      await trigger.click()
      await expect(trigger).toHaveAttribute("aria-expanded", "true")

      if (name === "subagent") await expect(group.getByText("Inspect the timeline", { exact: true })).toBeVisible()

      if (name !== "subagent")
        await expect(group.locator('[data-component="text-shimmer"][data-active="true"]')).toBeVisible()
      await expect(working).toBeVisible()
      await trigger.click()
      await expect(trigger).toHaveAttribute("aria-expanded", "false")
      await expect(working).toBeVisible()

    })
  }

  test("separates blocking and already-backgrounded work into two rows", async ({ page }) => {
    const backgroundID = "ses_background_existing"
    const blockingID = "ses_background_blocking"

    const timeline = await setupTimeline(page, {
      settings: { timelineDetail: detailed },
      sessionMessages: [
        user,
        {
          id: "msg_backgrounded",
          type: "assistant",
          agent: "build",
          model: { id: "model", providerID: "provider" },
          content: [
            {
              type: "tool",
              id: "call_backgrounded",
              name: "subagent",
              state: {
                status: "completed",
                input: { description: "Background task", agent: "explore" },
                content: [{ type: "text", text: "working" }],
                metadata: { sessionID: backgroundID, status: "running" },
              },
              time: { created: 2, completed: 3 },
            },
            {
              type: "tool",
              id: "call_shell_backgrounded",
              name: "shell",
              state: {
                status: "completed",
                input: { command: "sleep 120" },
                content: [{ type: "text", text: "working" }],
                metadata: { shellID: "shell_backgrounded", status: "running" },
              },
              time: { created: 2, completed: 3 },
            },
          ],
          time: { created: 2, completed: 3 },
        },
        {
          id: "msg_blocking",
          type: "assistant",
          agent: "build",
          model: { id: "model", providerID: "provider" },
          content: [
            {
              type: "tool",
              id: "call_blocking",
              name: "subagent",
              state: {
                status: "running",
                input: { description: "Foreground task", agent: "build" },
                metadata: { sessionID: blockingID },
              },
              time: { created: 4 },
            },
          ],
          time: { created: 4 },
        },
      ],
      sessions: [
        session(),
        session({ id: backgroundID, parentID: sessionID, title: "Background task", agent: "explore" }),
        session({ id: blockingID, parentID: sessionID, title: "Foreground task", agent: "build" }),
      ],
      sessionStatus: {
        [sessionID]: { type: "busy" },
        [backgroundID]: { type: "busy" },
        [blockingID]: { type: "busy" },
      },
    })

    await timeline.transport.send({
      id: "evt_background_shell_created",
      created: 3,
      type: "shell.created",
      location: { directory },
      data: {
        info: {
          id: "shell_backgrounded",
          status: "running",
          command: "sleep 120",
          cwd: directory,
          shell: "bash",
          file: "/tmp/background.out",
          metadata: { sessionID },
          time: { started: 2 },
        },
      },
    })
    const backgroundCard = page.locator('[data-timeline-part-id="call_backgrounded"]')
    await expect(backgroundHint(page)).toHaveCount(0)

    const used = page
      .locator('[data-timeline-part-ids="call_backgrounded,call_shell_backgrounded,call_blocking"]')
      .locator(':scope > [data-component="collapsible"] > [data-slot="collapsible-trigger"]')

    await expect(used).toHaveText(/^Used\s*3\s*Agent, Shell$/)
    await expect(used).toHaveAttribute("aria-expanded", "false")
    await page.getByRole("button", { name: "3 running", exact: true }).click()
    const list = page.getByRole("menu", { name: "3 running", exact: true })
    await expect(list.getByRole("menuitem")).toHaveText([
      /^Build\s*Foreground task$/,
      /^Explore\s*Background task$/,
      /^Shell\s*sleep 120$/,
    ])
    await list.getByRole("menuitem", { name: /sleep 120/ }).click()
    await expect(list).toHaveCount(0)
    await expect(used).toHaveAttribute("aria-expanded", "true")
    const shellCall = page.locator('[data-timeline-part-id="call_shell_backgrounded"]')
    await expect(shellCall.locator('[data-slot="collapsible-trigger"]')).toHaveAttribute("aria-expanded", "true")
    await expect(shellCall).toBeInViewport()

    await page.getByRole("button", { name: "3 running", exact: true }).click()

    const interrupt = page.waitForRequest(
      (request) =>
        request.method() === "POST" && new URL(request.url()).pathname === `/api/session/${blockingID}/interrupt`,
    )

    const foreground = list.getByRole("menuitem", { name: /Foreground task/ })

    await foreground.hover()
    await foreground.getByRole("button", { name: "Interrupt subagent", exact: true }).click()
    await interrupt
    await expect(list).toBeVisible()

    const kill = page.waitForRequest(
      (request) => request.method() === "DELETE" && new URL(request.url()).pathname === "/api/shell/shell_backgrounded",
    )

    await list.getByRole("menuitem", { name: /sleep 120/ }).hover()
    await page.keyboard.press("Delete")
    await kill
    await page.keyboard.press("Escape")
    await expect(list).toHaveCount(0)
    await expect(backgroundCard).toContainText("Background task (background)")
    await expect(backgroundCard.locator('[data-component="session-progress-indicator-v2"]')).toBeVisible()
    await expect(
      page.locator('[data-timeline-part-id="call_shell_backgrounded"] [data-component="text-shimmer"]'),
    ).toHaveAttribute("data-active", "true")

    // SAFETY: the transport forwards this payload unchanged, and the client marks a session idle from
    // `type` and `data.sessionID` alone; the child session's event needs no durable metadata here.
    await timeline.transport.send({
      id: "evt_background_succeeded",
      created: Date.now(),
      type: "session.execution.succeeded",
      data: { sessionID: backgroundID },
    } as never)
    await expect(backgroundCard.locator('[data-component="session-progress-indicator-v2"]')).toHaveCount(0)
    await expect(backgroundCard).toContainText("Background task (background)")
  })

  test("moves between siblings and to the parent's shell from inside a subagent", async ({ page }) => {
    const siblings = [
      { id: "ses_sibling_one", agent: "explore", description: "Draft TUI proposal" },
      { id: "ses_sibling_two", agent: "build", description: "Fix context controls" },
    ]

    const timeline = await setupTimeline(page, {
      settings: { timelineDetail: detailed },
      sessionMessages: [
        user,
        {
          id: "msg_sibling_shell",
          type: "assistant",
          agent: "build",
          model: { id: "model", providerID: "provider" },
          content: [
            {
              type: "tool",
              id: "call_sibling_shell",
              name: "shell",
              state: {
                status: "completed",
                input: { command: "sleep 120" },
                content: [{ type: "text", text: "working" }],
                metadata: { shellID: "shell_sibling", status: "running" },
              },
              time: { created: 2, completed: 3 },
            },
          ],
          time: { created: 2, completed: 3 },
        },
        {
          id: "msg_siblings",
          type: "assistant",
          agent: "build",
          model: { id: "model", providerID: "provider" },
          content: siblings.map((item) => ({
            type: "tool" as const,
            id: `call_${item.id}`,
            name: "subagent",
            state: {
              status: "running" as const,
              input: { description: item.description, agent: item.agent },
              metadata: { sessionID: item.id },
            },
            time: { created: 2 },
          })),
          time: { created: 2 },
        },
      ],
      sessions: [
        session(),
        ...siblings.map((item) =>
          session({ id: item.id, parentID: sessionID, title: item.description, agent: item.agent }),
        ),
      ],
      sessionStatus: Object.fromEntries(
        [sessionID, ...siblings.map((item) => item.id)].map((id) => [id, { type: "busy" }]),
      ),
    })

    await timeline.transport.send({
      id: "evt_sibling_shell_created",
      created: 3,
      type: "shell.created",
      location: { directory },
      data: {
        info: {
          id: "shell_sibling",
          status: "running",
          command: "sleep 120",
          cwd: directory,
          shell: "bash",
          file: "/tmp/sibling.out",
          metadata: { sessionID },
          time: { started: 2 },
        },
      },
    })

    const header = page.locator("[data-session-title]")
    const trigger = header.getByRole("button", { name: "3 running", exact: true })
    const list = page.getByRole("menu", { name: "3 running", exact: true })

    await trigger.click()
    await list.getByRole("menuitem", { name: /Draft TUI proposal/ }).click()
    await expect(page).toHaveURL(/\/session\/ses_sibling_one$/)

    await trigger.click()
    await expect(list.getByRole("menuitem")).toHaveText([
      /^Explore\s*Draft TUI proposal/,
      /^Build\s*Fix context controls/,
      /^Shell\s*sleep 120/,
    ])
    await expect(list.getByRole("menuitem", { name: /Draft TUI proposal/ })).toHaveAttribute("aria-current", "page")
    await expect(list.getByRole("menuitem", { name: /Fix context controls/ })).not.toHaveAttribute("aria-current")
    await list.getByRole("menuitem", { name: /Fix context controls/ }).click()
    await expect(page).toHaveURL(/\/session\/ses_sibling_two$/)

    // The shell call lives in the parent: the row opens it there, expanded.
    await trigger.click()
    await list.getByRole("menuitem", { name: /sleep 120/ }).click()
    await expect(page).toHaveURL(new RegExp(`/session/${sessionID}$`))

    const shellCall = page.locator('[data-timeline-part-id="call_sibling_shell"]')

    await expect(shellCall.locator('[data-slot="collapsible-trigger"]')).toHaveAttribute("aria-expanded", "true")
    await expect(shellCall).toBeInViewport()
  })
})

test.describe("compaction", () => {
  test("keeps live and completed compaction summaries under an opt-in disclosure", async ({ page }, testInfo) => {
    const timeline = await setupTimeline(page, {
      settings: { timelineDetail: { ...detailed, notices: { placement: "separate" } } },
      sessionMessages: [user, completed],
      sessionStatus: { [sessionID]: { type: "busy" } },
    })

    await timeline.send(compactionStarted({ sessionID, reason: "manual", recent: "" }))
    const compaction = page.locator('[data-component="session-compaction-message"]')
    await expect(compaction.getByText("Session compaction started", { exact: true })).toBeVisible()
    await expect(compaction.getByRole("status").getByLabel("Compacting", { exact: true })).toBeVisible()
    await expect(compaction.locator('[data-component="text-shimmer"]')).toHaveAttribute("data-active", "true")
    await expect(compaction.getByText("Session compacted", { exact: true })).toHaveCount(0)
    const showSummary = compaction.getByRole("button", { name: "Show compaction summary", exact: true })
    const hideSummary = compaction.getByRole("button", { name: "Hide compaction summary", exact: true })
    await expect(showSummary).toHaveAttribute("aria-expanded", "false")
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible()
    await expect(page.locator('[data-component="session-working"]')).toHaveCount(0)

    await page.setViewportSize({ width: 480, height: 900 })
    await expect(compaction.getByText("Session compaction started", { exact: true })).toBeInViewport()

    await timeline.send(compactionDelta({ sessionID, text: "## Checkpoint\n\nStreamed implementation details." }))
    await expect(compaction.locator('[data-component="text-part"]')).toHaveCount(0)
    await expect(compaction).not.toContainText("Streamed implementation details.")
    await page.screenshot({ path: testInfo.outputPath("compaction-collapsed.png") })
    await showSummary.click()
    await expect(hideSummary).toHaveAttribute("aria-expanded", "true")
    await expect(compaction.getByRole("heading", { name: "Checkpoint" })).toBeVisible()
    await expect(compaction).toContainText("Streamed implementation details.")
    await timeline.send(compactionDelta({ sessionID, text: " More streamed details." }))
    await expect(compaction).toContainText("Streamed implementation details. More streamed details.")
    await page.screenshot({ path: testInfo.outputPath("compaction-live-expanded.png") })
    const running = compaction.getByRole("status").getByLabel("Compacting", { exact: true })
    await expect(running).toBeVisible()
    await expect
      .poll(async () => {
        const summary = await compaction.locator('[data-component="text-part"]').boundingBox()
        const status = await running.boundingBox()

        return !!summary && !!status && status.y >= summary.y + summary.height
      })
      .toBe(true)
    await expect(compaction.getByText("Session compacted", { exact: true })).toHaveCount(0)
    await hideSummary.click()
    await expect(showSummary).toHaveAttribute("aria-expanded", "false")
    await timeline.send(compactionDelta({ sessionID, text: " Still hidden while generation continues." }))
    await expect(compaction.locator('[data-component="text-part"]')).toHaveCount(0)

    await timeline.send(
      compactionEnded({
        sessionID,
        reason: "manual",
        text: "## Checkpoint\n\nFinal implementation details.",
        recent: "",
      }),
    )
    await expect(showSummary).toHaveAttribute("aria-expanded", "false")
    await expect(compaction.locator('[data-component="text-part"]')).toHaveCount(0)
    await expect(compaction).not.toContainText("Final implementation details.")
    await showSummary.press("Enter")
    await expect(hideSummary).toHaveAttribute("aria-expanded", "true")
    await expect(compaction).toContainText("Final implementation details.")
    await expect(compaction).not.toContainText("Streamed implementation details.")
    await expect(compaction.getByText("Session compaction started", { exact: true })).toBeVisible()
    await expect(compaction.getByText("Session compacted", { exact: true })).toBeVisible()
    await expect
      .poll(async () => {
        const summary = await compaction.locator('[data-component="text-part"]').boundingBox()
        const done = await compaction.getByText("Session compacted", { exact: true }).boundingBox()

        return !!summary && !!done && done.y >= summary.y + summary.height
      })
      .toBe(true)
    await expect(compaction.getByRole("status")).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible()
    await expect(page.locator('[data-component="session-working"]')).toBeVisible()
  })

  test("saved compaction summaries start closed when loading history", async ({ page }) => {
    // The live keeper above cannot prove the restored-history default.
    await setupTimeline(page, {
      sessionMessages: [
        user,
        completed,
        {
          id: "msg_saved_compaction",
          type: "compaction",
          status: "completed",
          reason: "manual",
          summary: "Saved compaction details.",
          recent: "",
          time: { created: 1700000004000 },
        },
      ],
    })
    const compaction = page.locator('[data-component="session-compaction-message"]')
    const showSummary = compaction.getByRole("button", { name: "Show compaction summary", exact: true })
    await expect(compaction.getByText("Session compacted", { exact: true })).toBeVisible()
    await expect(showSummary).toHaveAttribute("aria-expanded", "false")
    await expect(compaction.locator('[data-component="text-part"]')).toHaveCount(0)
    await page.reload()
    await expect(showSummary).toHaveAttribute("aria-expanded", "false")
    await showSummary.click()
    await expect(compaction).toContainText("Saved compaction details.")
    await compaction.getByRole("button", { name: "Hide compaction summary", exact: true }).press("Space")
    await expect(compaction.locator('[data-component="text-part"]')).toHaveCount(0)
  })

  const outcomes = {
    failed: {
      reason: "auto",
      partial: "Partial summary that should be discarded.",
      error: {
        type: "compaction.failed",
        message: 'Error: {"error":{"type":"ProviderError","message":"The provider rejected the summary."}}',
      },
      label: "Session compaction failed",
      shown: "ProviderError: The provider rejected the summary.",
    },
    cancelled: {
      reason: "manual",
      partial: "Summary before cancellation.",
      error: { type: "aborted", message: "Cancellation detail should stay hidden." },
      label: "Session compaction cancelled",
      shown: undefined,
    },
    interrupted: {
      reason: "auto",
      partial: "Partial automatic summary.",
      error: { type: "compaction.interrupted", message: "Compaction was interrupted" },
      label: "Session compaction interrupted",
      shown: undefined,
    },
  } as const

  const labels = Object.values(outcomes).map((outcome) => outcome.label)

  // Failed then cancelled share one history, so each boundary must keep its own outcome.
  for (const names of [["failed", "cancelled"], ["interrupted"]] as const) {
    test(`ends running compactions as ${names.join(", then ")}`, async ({ page }) => {
      const timeline = await setupTimeline(
        page,
        names[0] === "interrupted"
          ? { sessionMessages: [user, completed], sessionStatus: { [sessionID]: { type: "busy" } } }
          : { sessionMessages: [user, completed] },
      )

      const compactions = page.locator('[data-component="session-compaction-message"]')

      for (const [index, name] of names.entries()) {
        const outcome = outcomes[name]
        await timeline.send(compactionStarted({ sessionID, reason: outcome.reason, recent: "" }))
        await timeline.send(compactionDelta({ sessionID, text: outcome.partial }))
        await expect(compactions).toHaveCount(index + 1)
        const compaction = compactions.nth(index)
        await compaction.getByRole("button", { name: "Show compaction summary", exact: true }).click()
        await expect(compaction).toContainText(outcome.partial)

        if (name === "interrupted") {
          await expect(compaction.getByRole("status").getByLabel("Compacting", { exact: true })).toBeVisible()

          const request = page.waitForRequest(
            (request) =>
              request.method() === "POST" && new URL(request.url()).pathname === `/api/session/${sessionID}/interrupt`,
          )

          await page.getByRole("button", { name: "Stop", exact: true }).click()
          await request
        }

        await timeline.send(compactionFailed({ sessionID, reason: outcome.reason, error: outcome.error }))
        await expect(compaction.getByText(outcome.label, { exact: true })).toBeVisible()
      }

      await expect(compactions).toHaveCount(names.length)

      for (const [index, name] of names.entries()) {
        const outcome = outcomes[name]
        const compaction = compactions.nth(index)
        await expect(compaction.getByText("Session compaction started", { exact: true })).toBeVisible()
        await expect(compaction.getByText(outcome.label, { exact: true })).toBeVisible()

        for (const other of labels.filter((label) => label !== outcome.label))
          await expect(compaction.getByText(other, { exact: true })).toHaveCount(0)
        await expect(compaction.getByText("Session compacted", { exact: true })).toHaveCount(0)
        await expect(compaction.getByRole("status")).toHaveCount(0)
        await expect(compaction).not.toContainText(outcome.partial)
        await expect(compaction.getByRole("button", { name: "Show compaction summary", exact: true })).toHaveCount(0)

        if (outcome.shown) await expect(compaction.getByText(outcome.shown, { exact: true })).toBeVisible()

        if (!outcome.shown) await expect(compaction).not.toContainText(outcome.error.message)
      }
    })
  }
})

test("reducer-hardening: converges when idle arrives before final part and message completion", async ({ page }) => {
  const textID = "prt_event_order_text"
  const assistant = assistantMessage([textPart(textID, "Partial")], { completed: false })
  const timeline = await setupTimeline(page, { messages: [userMessage(), assistant] })
  await timeline.send(status("busy"))
  await timeline.send(status("idle"))
  await timeline.send(partUpdated(textPart(textID, "Final after early idle")))
  await timeline.send(messageUpdated(completedAssistantInfo(assistant)))

  await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
  await expect(page.locator(`[data-timeline-part-id="${renderedPartID(textID)}"]`)).toContainText(
    "Final after early idle",
  )
})

test("changes timeline presets and saves custom thinking details", async ({ page }) => {
  await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([
        reasoningPart("prt_reasoning_settings", "## Inspecting stability\n\nThe selected mode controls these details."),
      ]),
    ],
  })
  const part = page.locator(`[data-timeline-part-id="${assistantID}:reasoning:0"]`)
  const settings = page.getByTestId("settings-screen")
  await page.keyboard.press("Control+,")
  const slider = settings.getByRole("slider", { name: "Timeline detail", exact: true })
  await expect(slider).toBeEnabled()
  await slider.press("Home")

  for (const [index, name] of ["Messages only", "Quiet", "Compact", "Detailed", "Everything"].entries()) {
    if (index) await slider.press("ArrowRight")
    await expect(slider).toHaveValue(String(index))
    await expect(slider).toHaveAttribute("aria-valuetext", name)
  }

  await slider.press("End")
  await settings.getByRole("button", { name: "Advanced", exact: true }).click()
  const grouped = settings.getByRole("switch", { name: "Thinking grouped", exact: true })
  const collapsed = settings.getByRole("switch", { name: "Thinking collapsed", exact: true })
  await expect(grouped).not.toBeChecked()
  await expect(collapsed).not.toBeChecked()
  await settings.locator('[data-category="thinking"][data-field="placement"] [data-slot="switch-control"]').click()
  await settings.locator('[data-category="thinking"][data-field="details"] [data-slot="switch-control"]').click()
  await expect(grouped).toBeChecked()
  await expect(collapsed).toBeChecked()
  await expect(slider).toHaveAttribute("aria-valuetext", "Custom")
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem("settings.v3") ?? "{}").general?.timelineDetail?.thinking),
    )
    .toEqual({ placement: "grouped", details: "collapsed" })
  await settings.getByRole("button", { name: "Back to app", exact: true }).click()
  await expect(settings).toBeHidden()
  await page.getByRole("button", { name: "Used 1 Thought", exact: true }).click()
  await expect(part.getByRole("button")).toHaveAttribute("aria-expanded", "false")
  await part.getByRole("button").click()
  await expect(part.getByText("The selected mode controls these details.", { exact: true })).toBeVisible()
})

test.describe("shell completion", () => {
  const background = {
    id: "sh_background",
    status: "running",
    command: "bun run check",
    cwd: directory,
    shell: "bash",
    file: "/tmp/check.out",
    metadata: { sessionID },
    time: { started: 2 },
  } satisfies ShellInfo

  // Every exit status takes the same completion path, so one grouped and one standalone row cover it.
  for (const { grouped, exit } of [
    { grouped: false, exit: "exited" },
    { grouped: true, exit: "killed" },
  ] as const) {
    test(`stops ${grouped ? "grouped" : "standalone"} background shell shimmer when ${exit}`, async ({ page }) => {
      const message: SessionMessageAssistant = {
        id: "msg_background",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [
          ...(grouped
            ? [
                {
                  type: "tool",
                  id: "call_read",
                  name: "read",
                  state: {
                    status: "completed",
                    input: { path: "package.json" },
                    content: [{ type: "text", text: "{}" }],
                    metadata: {},
                  },
                  time: { created: 1, completed: 2 },
                } satisfies SessionMessageAssistant["content"][number],
              ]
            : []),
          ...[background.id, "sh_other"].map((id): SessionMessageAssistant["content"][number] => ({
            type: "tool",
            id: `call_${id}`,
            name: "shell",
            state: {
              status: "completed",
              input: { command: background.command },
              content: [{ type: "text", text: "Command moved to the background." }],
              metadata: { shellID: id, status: "running" },
            },
            time: { created: 2, completed: 3 },
          })),
        ],
        time: { created: 2, completed: 3 },
      }

      const state = { finished: false, requests: 0 }
      // Larger than one server page (65,536 bytes), so the final output is read in two pages. The card shows its most
      // recent 64 KiB.
      const finished = `Checking project\n${Array.from({ length: 8_192 }, (_, index) => `step ${String(index + 1).padStart(5, "0")}\n`).join("")}Check finished\n`
      const tail = finished.slice(-64 * 1024)
      // Byte cursors of this shell's output reads.
      const reads: number[] = []
      page.on("request", (request) => {
        const url = new URL(request.url())

        if (url.pathname === `/api/shell/${background.id}/output`)
          reads.push(Number(url.searchParams.get("cursor") ?? 0))
      })

      const timeline = await setupTimeline(page, {
        viewport: { width: grouped ? 390 : 1400, height: 900 },
        settings: { shellToolPartsExpanded: !grouped },
        sessionStatus: { [sessionID]: { type: "busy" } },
        sessionMessages: [
          { id: "msg_user", type: "user", text: "Run two independent checks.", time: { created: 1 } },
          message,
        ],
        shellCommands: () => [...(state.finished ? [] : [background]), { ...background, id: "sh_other" }],
        shellOutput: ({ id }) => {
          if (id !== background.id) return "Checking project\n"
          state.requests++

          return state.finished ? finished : "Checking project\n"
        },
      })

      await page.clock.install()
      await page.reload()
      await timeline.transport.waitForConnection()

      const groupTrigger = page
        .locator('[data-component="collapsed-tool-group"]')
        .locator(':scope > [data-component="collapsible"] > [data-slot="collapsible-trigger"]')

      if (grouped) {
        await expect(page.locator('[data-component="collapsed-tool-group"]')).toHaveAttribute(
          "data-timeline-part-ids",
          "call_read,call_sh_background,call_sh_other",
        )
        await expect(groupTrigger).toHaveAttribute("aria-expanded", "false")
        await groupTrigger.click()
      }

      const card = page.locator(`[data-timeline-part-id="call_${background.id}"]`)
      const shimmer = card.locator('[data-component="text-shimmer"]')
      const other = page.locator('[data-timeline-part-id="call_sh_other"] [data-component="text-shimmer"]')
      await expect(shimmer).toHaveAttribute("data-active", "true")
      await expect(other).toHaveAttribute("data-active", "true")

      if (grouped) await card.locator('[data-slot="collapsible-trigger"]').click()
      await expect(card.locator('[data-slot="bash-result"]')).toHaveText("Checking project")

      state.finished = true
      await timeline.transport.send({
        id: "evt_shell_exited",
        created: 4,
        type: "shell.exited",
        location: { directory },
        data: { id: background.id, status: exit, exit: exit === "exited" ? 0 : 1 },
      })
      await expect(shimmer).toHaveAttribute("data-active", "false")
      await expect(other).toHaveAttribute("data-active", "true")
      await expect(card.locator('[data-slot="bash-result"]')).toHaveText(tail)
      // The first page from the running output's cursor ends 65,536 bytes later; the second page starts there.
      expect(reads).toContain(17 + 65_536)
      await expect(card.locator('[data-slot="collapsible-trigger"]')).toHaveAttribute("aria-expanded", "true")

      const requests = state.requests
      await page.clock.fastForward(5_000)
      expect(state.requests).toBe(requests)

      reads.length = 0
      await page.reload()

      if (grouped) await groupTrigger.click()
      await expect(shimmer).toHaveAttribute("data-active", "false")
      await expect(other).toHaveAttribute("data-active", "true")

      // An expanded card reads the exited shell's final output from the start, again in two pages.
      if (grouped) return
      await expect(card.locator('[data-slot="bash-result"]')).toHaveText(tail)
      expect(reads).toContain(65_536)
    })
  }

  test("shows the authoritative foreground result after streaming shell output", async ({ page }) => {
    const timeline = await setupTimeline(page, {
      settings: { shellToolPartsExpanded: true },
      sessionMessages: [
        { id: "msg_user", type: "user", text: "Run the check.", time: { created: 1 } },
        {
          id: "msg_foreground",
          type: "assistant",
          agent: "build",
          model: { id: "model", providerID: "provider" },
          content: [
            {
              type: "tool",
              id: "call_foreground",
              name: "shell",
              state: {
                status: "running",
                input: { command: background.command },
                metadata: { shellID: background.id },
              },
              time: { created: 2 },
            },
          ],
          time: { created: 2 },
        },
      ],
      shellOutput: ({ id }) => (id === background.id ? "Checking project\n" : undefined),
    })

    const card = page.locator('[data-timeline-part-id="call_foreground"]')
    const shimmer = card.locator('[data-component="text-shimmer"]')
    await expect(shimmer).toHaveAttribute("data-active", "true")
    await expect(card.locator('[data-slot="bash-result"]')).toHaveText("Checking project")
    await timeline.transport.send({
      id: "evt_foreground_complete",
      created: 3,
      type: "session.tool.success",
      durable: { aggregateID: sessionID, seq: 0, version: 2 },
      data: {
        sessionID,
        assistantMessageID: "msg_foreground",
        id: "call_foreground",
        executed: true,
        content: [{ type: "text", text: "Checking project\nCheck finished\nCommand exited with code 0." }],
        metadata: { status: "completed", exit: 0 },
      },
    })
    await expect(shimmer).toHaveAttribute("data-active", "false")
    await expect(card.locator('[data-slot="bash-result"]')).toHaveText(
      "Checking project\nCheck finished\nCommand exited with code 0.",
    )
  })
})

function runningSubagent(): SessionMessageAssistant {
  return {
    ...completed,
    content: [
      {
        type: "tool",
        id: "call_subagent",
        name: "subagent",
        state: { status: "running", input: { description: "Inspect code" }, metadata: { status: "running" } },
        time: { created: 2 },
      },
    ],
    time: { created: 2 },
  }
}

function backgroundHint(page: Page) {
  return page.getByRole("button", { name: /move running work to the background/i })
}

function patchFile(file: string, status: "added" | "modified" | "deleted") {
  return {
    file,
    status,
    patch: {
      added: "@@ -0,0 +1 @@\n+export const after = true",
      deleted: "@@ -1 +0,0 @@\n-export const before = true",
      modified: "@@ -1 +1 @@\n-export const before = true\n+export const after = true",
    }[status],
    additions: status === "deleted" ? 0 : 1,
    deletions: status === "added" ? 0 : 1,
  }
}

function summaryDiff(index: number) {
  return {
    file: `src/diff-${index}.ts`,
    additions: 1,
    deletions: 1,
    status: "modified" as const,
    patch: `@@ -1 +1 @@\n-export const value = ${index}\n+export const value = ${index + 1}`,
  }
}
