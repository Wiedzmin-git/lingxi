import { createMemo, createSignal, For, Show } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { TitlebarItem } from "@opencode/gui-extensions/sdk"
import { useExtensionHost } from "./host"

/** TitlebarItem contributions placed in the titlebar (the default placement). */
export function useTitlebarItems() {
  const host = useExtensionHost()

  const items = createMemo(() =>
    host.list(TitlebarItem).filter((item) => (item.placement ?? "titlebar") === "titlebar"),
  )

  // Keyed by id so a pill keeps its element (and hover state) while its item changes.
  const ids = createMemo(() => items().map((item) => item.id), undefined, {
    equals: (a, b) => a.length === b.length && a.every((id, index) => id === b[index]),
  })

  return {
    ids,
    item: (id: string) => items().find((item) => item.id === id),
  }
}

export function TitlebarItems(props: { items: ReturnType<typeof useTitlebarItems>; vertical?: boolean }) {
  return (
    <For each={props.items.ids()}>
      {(id) => (
        <Show when={props.items.item(id)}>
          {(item) => <TitlebarItemButton item={item()} vertical={props.vertical} />}
        </Show>
      )}
    </For>
  )
}

function TitlebarItemButton(props: { item: TitlebarItem; vertical?: boolean }) {
  const [seen, setSeen] = createSignal<string>()

  const label = () => (
    <span
      class="px-3 text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-accent [font-weight:530] whitespace-nowrap tabular-nums"
    >
      {props.item.label}
    </span>
  )

  return (
    <div
      data-slot="titlebar-update"
      data-expanded={props.item.expanded || undefined}
      data-attention={!!props.item.attention && props.item.attention !== seen() || undefined}
      onPointerEnter={() => setSeen(props.item.attention)}
      onFocusIn={() => setSeen(props.item.attention)}
      class="group relative size-8 shrink-0 rounded-full bg-v2-background-bg-deep hover:z-30 focus-within:z-30"
      classList={{
        "self-start": props.vertical,
        "me-3": !props.vertical,
      }}
    >
      <button
        type="button"
        class="absolute top-0 z-10 flex h-full w-max items-center overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--v2-icon-icon-accent)_20%,var(--v2-background-bg-deep))] text-v2-icon-icon-accent focus-visible:outline-none [app-region:no-drag]"
        classList={{ "start-0 justify-start": props.vertical, "end-0 justify-end": !props.vertical }}
        onClick={() => props.item.run?.()}
        disabled={!!props.item.busy}
        aria-busy={!!props.item.busy}
        aria-label={props.item.title ?? props.item.label}
        title={props.item.title ?? props.item.label}
        aria-pressed={props.item.pressed}
      >
        <Show when={!props.vertical}>{label()}</Show>
        <span
          class="flex size-8 shrink-0 items-center justify-center"
        >
          <Show when={!props.item.busy} fallback={<span data-slot="titlebar-update-loader" aria-hidden="true" />}>
            <Show
              when={props.item.icon}
              fallback={
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="M7 11V3M3.5 7.63128L7 11L10.5 7.63128" stroke="currentColor" />
                </svg>
              }
            >
              {(icon) => <Icon name={icon()} size="small" />}
            </Show>
          </Show>
        </span>
        <Show when={props.vertical}>{label()}</Show>
      </button>
    </div>
  )
}
