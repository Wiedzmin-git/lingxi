import { Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { TextInput } from "@opencode/ui/text-input"
import { useDialog } from "@opencode/ui/context/dialog"
import { useLanguage } from "@/runtime/i18n/language"

export function ProjectNameDialog(props: {
  parent?: string
  name?: string
  save: (name: string) => Promise<void>
}) {
  const language = useLanguage()
  const dialog = useDialog()
  const [state, setState] = createStore({ name: props.name ?? "", saving: false, error: "" })

  const submit = () => {
    if (!state.name.trim() || state.saving) return
    setState({ saving: true, error: "" })
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Promise rejection is untyped; show only a native Error message or the localized fallback.
    void props.save(state.name.trim()).then(() => dialog.close()).catch((error: unknown) => {
      setState({ saving: false, error: error instanceof Error ? error.message : language.t("common.requestFailed") })
    })
  }

  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitle>{language.t(props.parent ? "sidebar.projects.create" : "sidebar.projects.rename")}</DialogTitle>
      </DialogHeader>
      <DialogBody class="flex min-w-0 flex-col gap-3 px-4 py-4">
        <Show when={props.parent}>
          <div class="flex min-w-0 flex-col gap-1 text-[13px] leading-4">
            <span>{language.t("sidebar.projects.parent")}</span>
            <bdi dir="ltr" class="break-all">{props.parent}</bdi>
          </div>
        </Show>
        <label class="flex flex-col gap-1 text-[13px] leading-4">
          {language.t(props.parent ? "sidebar.projects.name" : "sidebar.projects.displayName")}
          <TextInput
            autofocus
            value={state.name}
            disabled={state.saving}
            onInput={(event) => setState("name", event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.isComposing) return
              event.preventDefault()
              submit()
            }}
          />
        </label>
        <Show when={state.error}><p role="alert" class="text-v2-text-text-critical text-[13px] leading-4">{state.error}</p></Show>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" disabled={state.saving} onClick={() => dialog.close()}>{language.t("common.cancel")}</Button>
        <Button disabled={state.saving || !state.name.trim()} onClick={submit}>
          {language.t(state.saving && props.parent ? "sidebar.projects.creating" : "common.save")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
