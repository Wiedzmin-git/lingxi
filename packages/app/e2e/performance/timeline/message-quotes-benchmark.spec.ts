import { benchmark, expect } from "../benchmark"
import {
  assistantID,
  assistantMessage,
  partUpdated,
  sessionID,
  setupTimeline,
  textPart,
  userMessage,
  userText,
} from "../../utils/timeline"

declare global {
  interface Window {
    messageQuoteBenchmark?: { rangeMeasurements: number }
  }
}

benchmark(
  "keeps active message-quote geometry work bounded during a streamed event burst",
  async ({ page, report }) => {
    const quoteCount = 24
    const updateCount = 50
    const textID = "prt_message_quote_benchmark"
    const text = "Prefix active quote suffix"

    const quote = {
      sessionID,
      messageID: assistantID,
      userMessageID: "msg_1000_timeline_user",
      partID: `${assistantID}:text:0`,
      text: "active quote",
      start: "Prefix ".length,
      end: "Prefix active quote".length,
      before: "Prefix ",
      after: " suffix",
    }

    const annotation = userMessage([userText("Review these quotes")], {
      id: "msg_2000_quote_benchmark",
      created: 1700000002000,
    })

    annotation.metadata = {
      displayText: "Review these quotes",
      comments: Array.from({ length: quoteCount }, (_, index) => ({
        type: "note",
        origin: "message",
        icon: "comment",
        label: `Quote ${index + 1}`,
        subject: "a message",
        comment: `Comment ${index + 1}`,
        quote: { ...quote, number: index + 1 },
      })),
    }

    const timeline = await setupTimeline(page, {
      messages: [userMessage(), assistantMessage([textPart(textID, text)], { completed: false }), annotation],
    })

    const body = page.locator(`[data-timeline-part-id="${quote.partID}"] [data-slot="text-part-body"]`)
    const markers = page.locator('[data-component="message-quote-marker"]')

    await expect(markers).toHaveCount(quoteCount)
    await page.evaluate(() => {
      const getBoundingClientRect = Range.prototype.getBoundingClientRect

      window.messageQuoteBenchmark = { rangeMeasurements: 0 }
      Range.prototype.getBoundingClientRect = function () {
        const probe = window.messageQuoteBenchmark

        if (probe) probe.rangeMeasurements += 1

        return getBoundingClientRect.call(this)
      }
    })

    const started = performance.now()

  await timeline.send(
    Array.from({ length: updateCount }, (_, index) => partUpdated(textPart(textID, `${text} update-${index}`))).flat(),
  )
    await expect(body).toContainText(`update-${updateCount - 1}`)
    await expect(markers).toHaveCount(quoteCount)
    await expect
      .poll(() => page.evaluate(() => window.messageQuoteBenchmark?.rangeMeasurements ?? 0))
      .toBeGreaterThan(0)

    const completionObservedMs = performance.now() - started
    const rangeMeasurements = await page.evaluate(() => window.messageQuoteBenchmark?.rangeMeasurements ?? 0)

    report(
      {
        completionObservedMs,
        rangeMeasurements,
        measurementsPerQuote: rangeMeasurements / quoteCount,
        measurementsPerUpdate: rangeMeasurements / updateCount,
      },
      { quoteCount, updateCount, eventMode: "burst" },
    )
  },
)
