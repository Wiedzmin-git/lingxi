import { skipToken, useQuery } from "@tanstack/solid-query"
import { Button } from "@opencode/ui/button"
import { For, Show, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { createHomeController } from "@/home/model"
import { loadHomeSessionIndex } from "@/home/sessions/index"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection, serverName } from "@/runtime/server/registry"

export function ArchivedSessions() {
  const language = useLanguage()
  const home = createHomeController()
  const [state, setState] = createStore({ query: "" })

  const sessions = useQuery(() => {
    const context = home.server.focusedContext()
    const server = home.server.focused()

    return {
      queryKey: ["archived-sessions", server && ServerConnection.key(server)],
      refetchOnMount: "always" as const,
      queryFn: context
        ? ({ signal }: { signal: AbortSignal }) => loadHomeSessionIndex(context.sdk.api.session.list, signal, true)
        : skipToken,
    }
  })

  const records = createMemo(() => {
    const query = state.query.trim().toLocaleLowerCase()

    return (sessions.data ?? []).filter((session) =>
      `${session.title} ${session.id} ${session.location.directory}`.toLocaleLowerCase().includes(query),
    )
  })

  return (
    <>
      <div class="settings-tab-header">
        <h2 class="settings-tab-title">{language.t("settings.archived.title")}</h2>
        <p class="text-11-regular text-v2-text-text-muted">{language.t("settings.archived.description")}</p>
      </div>
      <div class="settings-tab-body settings-tab-body--sectioned">
      <div class="flex flex-wrap gap-2">
        <For each={home.server.list()}>
          {(server) => (
            <Button
              variant="ghost"
              aria-pressed={home.server.focused() === server}
              onClick={() => home.selection.focusServer(server)}
            >
              {serverName(server)}
            </Button>
          )}
        </For>
      </div>
      <Button variant="ghost" disabled={sessions.isFetching} onClick={() => void sessions.refetch()}>
        {language.t("settings.archived.refresh")}
      </Button>
      <input
        class="h-9 w-full rounded-md border border-v2-border-border-base bg-transparent px-3 text-[13px] leading-[var(--line-height-base)]"
        aria-label={language.t("settings.archived.search")}
        placeholder={language.t("settings.archived.search")}
        value={state.query}
        onInput={(event) => setState("query", event.currentTarget.value)}
      />
      <Show when={sessions.isPending}>
        <p class="text-11-regular text-v2-text-text-muted">{language.t("settings.archived.loading")}</p>
      </Show>
      <Show when={sessions.isError}>
        <p>{language.t("common.requestFailed")}</p>
      </Show>
      <Show when={!sessions.isPending && !sessions.isError && records().length === 0}>
        <p class="text-11-regular text-v2-text-text-muted">{language.t("settings.archived.empty")}</p>
      </Show>
      <div data-component="settings-list">
        <For each={records()}>
          {(session) => (
            <div data-component="settings-row">
              <div data-slot="settings-row-copy">
                <div data-slot="settings-row-title">{session.title}</div>
                <div data-slot="settings-row-description">{session.location.directory}</div>
              </div>
              <Button onClick={() => {
                const server = home.server.focused()

                if (server) home.project.openProjectSession(server, session.location.directory, session)
              }}>{language.t("settings.archived.open")}</Button>
            </div>
          )}
        </For>
      </div>
      </div>
    </>
  )
}
