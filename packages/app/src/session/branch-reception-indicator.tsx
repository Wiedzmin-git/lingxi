import { onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { skipToken, useQuery } from "@tanstack/solid-query"
import { Icon } from "@opencode/ui/icon"
import { usePlatform } from "@/runtime/platform/platform"
import { useLanguage } from "@/runtime/i18n/language"

export function BranchReceptionIndicator(props: { server: string; sessionID: string }) {
  const platform = usePlatform()
  const language = useLanguage()
  const [state, setState] = createStore({ visible: false })
  let anchor!: HTMLSpanElement
  onMount(() => {
    // Home can mount hundreds of rows. Observe their existing leading/row box,
    // not the conditional icon, so off-screen rows never start native polling.
    const observer = new IntersectionObserver((entries) => setState("visible", entries.some((entry) => entry.isIntersecting)))
    observer.observe(anchor.parentElement!)
    onCleanup(() => observer.disconnect())
  })
  // Query ownership is the exact server/branch pair; duplicate tab views share
  // observation work. Never read mail, contacts or the private invitation here.

  const status = useQuery(() => {
    const request = { operation: "status", server: props.server, sessionID: props.sessionID } as const
    const call = platform.sessionLink

    return {
      queryKey: ["branch-mail-status", request.server, request.sessionID],
      queryFn: call ? () => call(request) : skipToken,
      enabled: !!call && state.visible,
      retry: false,
      gcTime: 0,
      staleTime: 0,
      refetchInterval: 5000,
      refetchOnWindowFocus: true,
    }
  })

  const granted = () => !status.isError && !status.data?.error && status.data?.branchAddress?.active
  const ready = () => status.data?.listener === "ready"

  const label = () => language.t(ready()
    ? status.data?.branchAddress?.wake ? "branchMail.reception.wake" : "branchMail.reception.queue"
    : status.data?.branchAddress?.wake ? "branchMail.reception.wakePaused" : "branchMail.reception.queuePaused",
  { status: status.data?.listener ?? "" })

  return <span ref={anchor} class="contents"><Show when={granted()}>
    <span data-slot="branch-reception-indicator" role="img" aria-label={label()} title={label()}
      class="flex size-5 shrink-0 items-center justify-center rounded-[4px] border border-v2-border-border-muted bg-v2-background-bg-layer-02"
      classList={{ "text-v2-text-text-accent": ready(), "text-v2-text-text-faint": !ready() }}>
      <Icon name={ready() ? "download" : "circle-exclamation"} size="small" />
    </span>
  </Show></span>
}
