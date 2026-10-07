import { onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { useDialog } from "@opencode/ui/context/dialog"
import { useLanguage } from "@/runtime/i18n/language"
import type { MessageQuote } from "./schema"

export function MessageQuoteEditor(props: {
  quote: MessageQuote
  comment?: string
  onSave: (comment: string) => void
  onCancel: () => void
  onSource?: () => void
}) {
  const language = useLanguage()
  const [state, setState] = createStore({ comment: props.comment ?? "" })
  let textarea: HTMLTextAreaElement | undefined

  onMount(() => textarea?.focus())

  const save = () => {
    if (!state.comment.trim()) return
    props.onSave(state.comment.trim())
  }

  return (
    <div data-component="message-quote-editor" data-prevent-autofocus class="flex flex-col gap-3 p-3">
      <blockquote
        dir="auto"
        class="max-h-36 overflow-y-auto whitespace-pre-wrap break-words border-s-2 border-v2-border-border-base ps-3 text-[13px] leading-5 text-v2-text-text-muted"
      >
        {props.quote.text}
      </blockquote>
      <textarea
        ref={textarea}
        dir="auto"
        aria-label={language.t("message.quote.comment")}
        placeholder={language.t("message.quote.comment")}
        value={state.comment}
        rows={3}
        class="w-full resize-y rounded-md border border-v2-border-border-base bg-v2-background-bg-base p-2 text-[13px] leading-5 text-v2-text-text-base outline-none focus:border-v2-border-border-focus"
        onInput={(event) => setState("comment", event.currentTarget.value)}
        onKeyDown={(event) => {
          event.stopPropagation()

          if (event.isComposing || event.keyCode === 229) return

          if (event.key === "Escape") {
            event.preventDefault()
            props.onCancel()

            return
          }

          if (event.key !== "Enter" || event.shiftKey) return
          event.preventDefault()
          save()
        }}
      />
      <span class="text-[12px] leading-4 text-v2-text-text-muted">{language.t("message.quote.help")}</span>
      <div class="flex flex-wrap items-center gap-2">
        <Show when={props.onSource}>
          <Button size="small" variant="ghost-muted" onClick={props.onSource}>
            {language.t("message.quote.source")}
          </Button>
        </Show>
        <div class="ms-auto flex gap-2">
          <Button size="small" variant="ghost-muted" onClick={props.onCancel}>
            {language.t("common.cancel")}
          </Button>
          <Button size="small" variant="submit" disabled={!state.comment.trim()} onClick={save}>
            {language.t("common.save")}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function MessageQuoteDialog(props: {
  quote: MessageQuote
  comment: string
  onSave: (comment: string) => void
  onSource?: () => void
}) {
  const dialog = useDialog()
  const language = useLanguage()

  return (
    <Dialog>
      <DialogHeader>
        <DialogTitle>{language.t("message.quote.label", { number: props.quote.number })}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <MessageQuoteEditor
          {...props}
          onCancel={() => dialog.close()}
          onSave={(comment) => {
            props.onSave(comment)
            dialog.close()
          }}
          onSource={
            props.onSource
              ? () => {
                  dialog.close()
                  props.onSource?.()
                }
              : undefined
          }
        />
      </DialogBody>
    </Dialog>
  )
}

export function MessageQuoteDetails(props: { quote: MessageQuote; comment: string; onSource: () => void }) {
  const dialog = useDialog()
  const language = useLanguage()

  return (
    <Dialog>
      <DialogHeader>
        <DialogTitle>{language.t("message.quote.label", { number: props.quote.number })}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <div class="flex flex-col gap-3 p-3">
          <blockquote
            dir="auto"
            class="max-h-60 overflow-y-auto whitespace-pre-wrap break-words border-s-2 border-v2-border-border-base ps-3 text-[13px] leading-5 text-v2-text-text-muted"
          >
            {props.quote.text}
          </blockquote>
          <p dir="auto" class="whitespace-pre-wrap break-words text-[13px] leading-5 text-v2-text-text-base">
            {props.comment}
          </p>
          <Button
            size="small"
            variant="ghost-muted"
            onClick={() => {
              dialog.close()
              props.onSource()
            }}
          >
            {language.t("message.quote.source")}
          </Button>
        </div>
      </DialogBody>
    </Dialog>
  )
}
