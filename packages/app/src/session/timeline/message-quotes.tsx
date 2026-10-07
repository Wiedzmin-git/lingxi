import { For, Show, createEffect, createMemo, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { Portal } from "solid-js/web"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { useComposerState } from "@/composer/persistence"
import { readPromptPresentation } from "@/composer/comment-note"
import { MessageQuoteDetails, MessageQuoteDialog, MessageQuoteEditor } from "@/composer/message-quote-editor"
import type { MessageQuote, NoteComment } from "@/composer/schema"
import { useLanguage } from "@/runtime/i18n/language"
import { useData, useServer } from "@/runtime/server/current"
import { sessionHref } from "@/shell/routes/session"
import { MESSAGE_QUOTE_BODY, messageQuoteRange } from "./message-quote-range"
import "./message-quotes.css"

const HIGHLIGHT = "message-quotes"

type Marker = { key: string; note: NoteComment; draftID?: string }

type MarkerGroup = { key: string; markers: Marker[]; x: number; y: number }

export function MessageQuotes(props: {
  sessionID: () => string | undefined
  scroller: () => HTMLDivElement | undefined
  enabled: () => boolean
  onSelect: () => void
  revealMessage: (id: string, partID?: string) => void
}) {
  const prompt = useComposerState()
  const language = useLanguage()
  const data = useData()
  const server = useServer()
  const dialog = useDialog()

  const [state, setState] = createStore<{
    selection?: MessageQuote
    editing: boolean
    x: number
    y: number
    markerGroups: MarkerGroup[]
  }>({ editing: false, x: 0, y: 0, markerGroups: [] })

  let addButton: HTMLButtonElement | undefined
  let focusFrame: number | undefined

  const drafts = createMemo(() =>
    prompt.context.items().flatMap((item) => (item.type === "note" && item.quote ? [item] : [])),
  )

  const sent = createMemo(() => {
    const id = props.sessionID()

    if (!id) return []

    return data.session.message.list(id).flatMap((message) => {
      if (message.type !== "user") return []

      return (readPromptPresentation(message.metadata)?.comments ?? []).flatMap((note, index) =>
        note.type === "note" && note.quote ? [{ key: `${message.id}:${index}`, note }] : [],
      )
    })
  })

  const close = () => setState({ selection: undefined, editing: false })

  const focusComposer = () => {
    queueMicrotask(() => document.querySelector<HTMLElement>('[data-component="composer-editor"]')?.focus())
  }

  const cancel = () => {
    close()
    focusComposer()
  }

  const reveal = (quote: MessageQuote) => {
    props.onSelect()
    props.revealMessage(quote.userMessageID, quote.partID)
  }

  const capture = (event: Event) => {
    if (state.editing || !props.enabled()) return

    if (event.target instanceof Element && event.target.closest('[data-component="message-quote-popover"]')) return
    const selected = window.getSelection()
    const root = props.scroller()
    const id = props.sessionID()

    if (!(event instanceof KeyboardEvent) && event.target instanceof Element && !root?.contains(event.target))
      return close()

    if (!selected?.rangeCount || selected.isCollapsed || !root || !id) return close()
    const range = selected.getRangeAt(0)
    const element = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
    const body = element?.closest<HTMLElement>(MESSAGE_QUOTE_BODY)

    if (!body || !root.contains(body) || !body.contains(range.endContainer)) return close()
    const part = body.closest<HTMLElement>("[data-timeline-part-id]")
    const messageID = body.closest<HTMLElement>("[data-quote-message-id]")?.dataset.quoteMessageId
    const userMessageID = body.closest<HTMLElement>("[data-message-id]")?.dataset.messageId
    const partID = part?.dataset.timelinePartId
    const text = range.toString()

    if (!messageID || !userMessageID || !partID || !text.trim()) return close()
    const prefix = range.cloneRange()
    prefix.selectNodeContents(body)
    prefix.setEnd(range.startContainer, range.startOffset)
    const start = prefix.toString().length
    const end = start + text.length
    const number = Math.max(0, ...drafts().map((item) => item.quote?.number ?? 0)) + 1
    const rect = range.getBoundingClientRect()
    setState({
      selection: {
        sessionID: id,
        messageID,
        userMessageID,
        partID,
        text,
        start,
        end,
        before: (body.textContent ?? "").slice(Math.max(0, start - 32), start),
        after: (body.textContent ?? "").slice(end, end + 32),
        number,
      },
      x: Math.max(8, Math.min(rect.left, window.innerWidth - 340)),
      y: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 320)),
    })
    props.onSelect()

    if (event instanceof KeyboardEvent) {
      if (focusFrame !== undefined) cancelAnimationFrame(focusFrame)
      focusFrame = requestAnimationFrame(() => {
        focusFrame = undefined
        addButton?.focus()
      })
    }
  }

  onMount(() => {
    document.addEventListener("pointerup", capture)
    document.addEventListener("keyup", capture)
    onCleanup(() => {
      document.removeEventListener("pointerup", capture)
      document.removeEventListener("keyup", capture)

      if (focusFrame !== undefined) cancelAnimationFrame(focusFrame)
    })
  })

  createEffect(() => {
    props.sessionID()
    props.enabled()
    close()
  })

  createEffect(() => {
    const root = props.scroller()
    const items = [...sent(), ...drafts().map((note) => ({ key: note.key, note, draftID: note.commentID }))]
    const pending = state.editing ? state.selection : undefined

    if (!root || (!items.length && !pending) || !props.enabled()) {
      CSS.highlights?.delete(HIGHLIGHT)
      setState("markerGroups", [])

      return
    }

    const byPart = new Map<string, Marker[]>()

    items.forEach((item) => {
      const quote = item.note.quote

      if (!quote || quote.sessionID !== props.sessionID()) return
      const source = `${quote.messageID}:${quote.partID}`
      const group = byPart.get(source)

      if (group) {
        group.push(item)

        return
      }

      byPart.set(source, [item])
    })

    let frame: number | undefined
    let active = true

    const update = () => {
      const ranges: Range[] = []
      const box = root.getBoundingClientRect()
      const bodies = Array.from(root.querySelectorAll<HTMLElement>(MESSAGE_QUOTE_BODY))

      const bodyByPart = new Map(
        bodies.flatMap((body) => {
          const part = body.closest<HTMLElement>("[data-timeline-part-id]")
          const messageID = body.closest<HTMLElement>("[data-quote-message-id]")?.dataset.quoteMessageId
          const partID = part?.dataset.timelinePartId

          return messageID && partID ? [[`${messageID}:${partID}`, body] as const] : []
        }),
      )

      const pendingBody = pending ? bodyByPart.get(`${pending.messageID}:${pending.partID}`) : undefined

      const pendingRange = pending && pendingBody && messageQuoteRange(pendingBody, pending)

      if (pendingRange) ranges.push(pendingRange)

      const grouped = new Map<string, MarkerGroup>()

      bodies.forEach((body) => {
        const part = body.closest<HTMLElement>("[data-timeline-part-id]")
        const messageID = body.closest<HTMLElement>("[data-quote-message-id]")?.dataset.quoteMessageId
        const partID = part?.dataset.timelinePartId
        const markers = messageID && partID ? byPart.get(`${messageID}:${partID}`) : undefined

        if (!markers) return

        markers.forEach((marker) => {
          const quote = marker.note.quote

          if (!quote) return
          const range = messageQuoteRange(body, quote)

          if (!range) return
          ranges.push(range)
          // Markdown word spans and bidi runs split one line into several rectangles.
          const rect = range.getBoundingClientRect()

          if (!rect.height || rect.bottom < box.top || rect.top > box.bottom) return

          // The Markdown child owns `dir="auto"`; the text-part wrapper follows the document direction.
          const directional =
            body.querySelector<HTMLElement>('[data-component="markdown"]') ??
            body.closest<HTMLElement>('[dir="auto"]') ??
            body

          const content = directional.getBoundingClientRect()
          const desiredX = getComputedStyle(directional).direction === "rtl" ? content.left - 23 : content.right + 3
          const x = Math.max(box.left, Math.min(desiredX, box.right - 22))
          const key = `${Math.round(x)}:${Math.round(rect.top)}`
          const group = grouped.get(key)

          if (group) {
            group.markers.push(marker)

            return
          }

          grouped.set(key, { key, markers: [marker], x, y: rect.top })
        })
      })

      CSS.highlights?.set(HIGHLIGHT, new Highlight(...ranges))
      setState(
        "markerGroups",
        [...grouped.values()].map((group) => ({
          ...group,
          y: Math.max(box.top, Math.min(group.y, box.bottom - group.markers.length * 22)),
        })),
      )
    }

    const schedule = () => {
      if (frame !== undefined) return
      frame = requestAnimationFrame(() => {
        frame = undefined
        update()
      })
    }

    update()
    const resize = new ResizeObserver(schedule)
    const observed = new Set<HTMLElement>()

    const observeGeometry = () => {
      root.querySelectorAll<HTMLElement>(`${MESSAGE_QUOTE_BODY}, [data-timeline-row]`).forEach((element) => {
        if (observed.has(element)) return
        observed.add(element)
        resize.observe(element)
      })
      observed.forEach((element) => {
        if (root.contains(element)) return
        observed.delete(element)
        resize.unobserve(element)
      })
    }

    const observer = new MutationObserver(() => {
      observeGeometry()
      schedule()
    })

    observer.observe(root, { attributes: true, childList: true, subtree: true, characterData: true })
    resize.observe(root)
    observeGeometry()
    root.addEventListener("scroll", schedule)
    root.addEventListener("load", schedule, true)
    window.addEventListener("resize", schedule)
    document.fonts?.addEventListener("loadingdone", schedule)
    void document.fonts?.ready.then(() => {
      if (active) schedule()
    })
    onCleanup(() => {
      active = false
      observer.disconnect()
      resize.disconnect()
      root.removeEventListener("scroll", schedule)
      root.removeEventListener("load", schedule, true)
      window.removeEventListener("resize", schedule)
      document.fonts?.removeEventListener("loadingdone", schedule)

      if (frame !== undefined) cancelAnimationFrame(frame)
      CSS.highlights?.delete(HIGHLIGHT)
    })
  })

  return (
    <Portal>
      <Show when={props.enabled() && state.selection} keyed>
        {(quote) => (
          <div
            data-component="message-quote-popover"
            data-prevent-autofocus
            dir={document.documentElement.dir === "rtl" ? "rtl" : "ltr"}
            class="fixed z-50 max-w-[calc(100vw-16px)] rounded-lg border border-v2-border-border-base bg-v2-background-bg-base shadow-lg"
            style={{ left: `${state.x}px`, top: `${state.y}px`, width: state.editing ? "330px" : undefined }}
            onPointerDown={(event) => {
              if (!state.editing) event.preventDefault()
            }}
          >
            <Show
              when={state.editing}
              fallback={
                <Button
                  ref={(element: HTMLButtonElement) => (addButton = element)}
                  size="small"
                  variant="ghost-muted"
                  onClick={() => setState("editing", true)}
                >
                  {language.t("message.quote.add")}
                </Button>
              }
            >
              <MessageQuoteEditor
                quote={quote}
                onCancel={cancel}
                onSave={(comment) => {
                  const target = prompt.capture()
                  target.context.add({
                    type: "note",
                    origin: "message",
                    icon: "comment",
                    label: language.t("message.quote.label", { number: quote.number }),
                    subject: `message ${quote.messageID}`,
                    href: `${sessionHref(server.key, quote.sessionID)}#message-${quote.userMessageID}`,
                    quote,
                    comment,
                    commentID: crypto.randomUUID(),
                  })
                  window.getSelection()?.removeAllRanges()
                  close()
                  focusComposer()
                }}
              />
            </Show>
          </div>
        )}
      </Show>
      <For each={state.markerGroups}>
        {(group) => (
          <div
            data-component="message-quote-marker-group"
            class="fixed z-30 flex flex-col gap-0.5"
            style={{ left: `${group.x}px`, top: `${group.y}px` }}
          >
            <For each={group.markers}>
              {(marker) => (
                <button
                  type="button"
                  data-component="message-quote-marker"
                  data-prevent-autofocus
                  class="flex h-5 min-w-5 items-center justify-center rounded-full border border-v2-border-border-base bg-v2-background-bg-base px-1 text-[11px] leading-4 text-v2-text-text-base"
                  aria-label={language.t("message.quote.marker", {
                    number: marker.note.quote?.number ?? 0,
                    text: marker.note.quote?.text ?? "",
                    comment: marker.note.comment,
                  })}
                  title={`${marker.note.quote?.text}\n\n${marker.note.comment}`}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => {
                    const quote = marker.note.quote

                    if (!quote) return
                    const draftID = marker.draftID

                    if (!draftID)
                      return dialog.show(() => (
                        <MessageQuoteDetails
                          quote={quote}
                          comment={marker.note.comment}
                          onSource={() => reveal(quote)}
                        />
                      ))
                    dialog.show(() => (
                      <MessageQuoteDialog
                        quote={quote}
                        comment={marker.note.comment}
                        onSave={(comment) => prompt.context.updateComment(draftID, { comment })}
                        onSource={() => reveal(quote)}
                      />
                    ))
                  }}
                >
                  {marker.note.quote?.number}
                </button>
              )}
            </For>
          </div>
        )}
      </For>
    </Portal>
  )
}
