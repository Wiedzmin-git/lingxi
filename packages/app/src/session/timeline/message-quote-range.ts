import type { MessageQuote } from "@/composer/schema"

export const MESSAGE_QUOTE_BODY = '[data-slot="text-part-body"], [data-slot="user-message-content"]'

/** Rebuild a range from text rather than retaining nodes replaced by streamed Markdown. */
export function messageQuoteRange(body: HTMLElement, quote: MessageQuote) {
  if (!quote.text) return

  const text = body.textContent ?? ""
  const exact = text.slice(quote.start, quote.end) === quote.text ? quote.start : undefined
  const start = exact ?? findQuote(text, quote)

  if (start === undefined) return

  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
  const nodes: { node: Text; start: number; end: number }[] = []
  let offset = 0
  let node = walker.nextNode()

  while (node) {
    // SAFETY: SHOW_TEXT yields only Text nodes.
    const textNode = node as Text
    nodes.push({ node: textNode, start: offset, end: offset + textNode.length })
    offset += textNode.length
    node = walker.nextNode()
  }

  const first = nodes.find((item) => item.start <= start && item.end > start)
  const end = start + quote.text.length
  const last = nodes.find((item) => item.start < end && item.end >= end)

  if (!first || !last) return

  const range = document.createRange()
  range.setStart(first.node, start - first.start)
  range.setEnd(last.node, end - last.start)

  return range
}

function findQuote(text: string, quote: MessageQuote) {
  let best: { start: number; score: number; distance: number } | undefined
  let candidate = text.indexOf(quote.text)
  let candidates = 0

  while (candidate >= 0) {
    candidates += 1

    const score =
      Number(!!quote.before && text.slice(0, candidate).endsWith(quote.before)) +
      Number(!!quote.after && text.slice(candidate + quote.text.length).startsWith(quote.after))

    const distance = Math.abs(candidate - quote.start)

    if (!best || score > best.score || (score === best.score && distance < best.distance)) {
      best = { start: candidate, score, distance }
    }

    candidate = text.indexOf(quote.text, candidate + 1)
  }

  if (candidates === 1 || best?.score) return best?.start
}
