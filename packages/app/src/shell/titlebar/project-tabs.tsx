import { createEffect, createMemo, createResource, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Option, Schema } from "effect"
import { Project } from "@opencode/schema/project"
import { Menu } from "@opencode/ui/menu"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Tooltip } from "@opencode/ui/tooltip"
import { useDialog } from "@opencode/ui/context/dialog"
import { displayName } from "@opencode/ui/project-avatar"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection, serverName } from "@/runtime/server/registry"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useCommand } from "@/shell/commands/command"
import { tabKey, useTabs, type Tab } from "@/shell/tabs/tabs"
import { pathKey } from "@/workspaces/path-key"
import { containsDirectory } from "@opencode/util/path"
import { base64Encode } from "@opencode/util/encode"
import { createTabComposerState } from "@/composer/persistence"
import { SESSION_REFERENCE_MIME } from "@/composer/session-reference"
import { projectForSession } from "@/shell/layout/helpers"
import { isProjectDirectory } from "@/workspaces/paths"
import { useDirectoryPicker } from "@/workspaces/selection/picker"
import { useRevealProject } from "@/home/projects/reveal"
import { fileManagerApp } from "@/home/projects/file-manager"
import { showToast } from "@/shell/notifications/toast"
import { SessionTabEntry, DraftTabSlot, useTabShortcut } from "./tab-strip"
import { ProjectNameDialog } from "./project-name-dialog"

export function ProjectTabs(props: {
  tabs: Tab[]
  currentTab: Tab | undefined
  onNavigate: (tab: Tab, element?: HTMLDivElement) => void
  onClose: (tab: Tab) => void
  onReorder: (keys: string[]) => void
}) {
  const global = useGlobal()
  const tabs = useTabs()
  const language = useLanguage()
  const platform = usePlatform()
  const command = useCommand()
  const dialog = useDialog()
  const pick = useDirectoryPicker()
  const reveal = useRevealProject()

  const [state, setState] = createStore<{
    drag: string
    over: string
    moving: Record<string, { directory: string; inboxID?: string; request: symbol } | undefined>
    visible: Record<string, boolean>
  }>({
    drag: "",
    over: "",
    moving: {},
    visible: {},
  })

  const connections = () => global.servers.list()

  const context = (server: ServerConnection.Key) => {
    const connection = connections().find((item) => ServerConnection.key(item) === server)

    return connection ? global.ensureServerCtx(connection) : undefined
  }

  const directory = (tab: Tab) => {
    if (tab.type === "draft") return !tab.worktree || tab.worktree === "main" || tab.worktree === "create" ? tab.directory : tab.worktree

    return context(tab.server)?.data.session.get(tab.sessionId)?.location.directory
      ?? tabs.pendingSession(tab.server, tab.sessionId)?.draft.directory
      ?? tabs.info[tabKey(tab)]?.directory
  }

  const projectFor = (tab: Tab) => {
    const ctx = context(tab.server)
    const value = directory(tab)

    if (!ctx || !value) return undefined
    const projects = ctx.projects.list()

    const explicit = projects.filter((project) => containsDirectory(project.worktree, value))
      .toSorted((a, b) => b.worktree.length - a.worktree.length)[0]

    if (explicit) return explicit
    const session = tab.type === "session" ? ctx.data.session.get(tab.sessionId) : undefined

    if (session) return projectForSession(session, projects)

    return projects.filter((project) => isProjectDirectory(project, value))
      .toSorted((a, b) => b.worktree.length - a.worktree.length)[0]
  }

  // Grouping cannot depend on expanded rows being mounted: hydrate tab metadata once.
  createResource(
    () => props.tabs.filter((tab) => tab.type === "session").map((tab) => ({ tab, ctx: context(tab.server) }))
      .filter(({ ctx }) => ctx?.sdk.connection.status() === "connected"),
    (entries) => Promise.allSettled(entries.map(async ({ tab, ctx }) => {
      if (!ctx) return
      await Promise.all([ctx.data.session.sync(tab.sessionId), ctx.data.session.pending.sync(tab.sessionId)])
      const session = ctx.data.session.get(tab.sessionId)

      if (session) createTabComposerState(tabs, tab, ctx.sdk.scope, { dir: base64Encode(session.location.directory), id: session.id })
      const key = tabKey(tab)
      const moving = state.moving[key]

      if (!moving?.inboxID) return

      // Consumption of a move control is not completed placement. A delivered
      // inbox row can disappear before session.moved reaches this client.
      if (pathKey(session?.location.directory ?? "") === pathKey(moving.directory)) setState("moving", key, undefined)
    })),
  )

  const groups = createMemo(() => connections().map((connection) => {
    const server = ServerConnection.key(connection)
    const ctx = global.ensureServerCtx(connection)
    const projects = createMemo(() => ctx.projects.list().toSorted((a, b) => Number(!!b.pinned) - Number(!!a.pinned)))
    const ownTabs = () => props.tabs.filter((tab) => tab.server === server)

    return {
      connection, server, ctx,
      projects,
      tabsFor: (directory: string) => ownTabs().filter((tab) => projectFor(tab)?.worktree === directory),
      other: () => ownTabs().filter((tab) => !projectFor(tab)),
    }
  }))

  const orderedTabs = createMemo(() => groups().flatMap((group) => [
    ...group.projects().flatMap((project) => project.expanded ? group.tabsFor(project.worktree) : []), ...group.other(),
  ]).filter((tab) => tab.type === "draft" || state.visible[tabKey(tab)]))

  command.register("titlebar-tab-cycle", () => [-1, 1].map((offset) => ({
    id: offset < 0 ? "tab.prev" : "tab.next", category: "tab", title: "", hidden: true,
    keybind: offset < 0 ? "mod+option+ArrowLeft,ctrl+shift+tab" : "mod+option+ArrowRight,ctrl+tab",
    onSelect: () => {
      const list = orderedTabs()
      const index = list.findIndex((tab) => props.currentTab && tabKey(tab) === tabKey(props.currentTab))
      const next = list[(index + offset + list.length) % list.length]

      if (next) props.onNavigate(next)
    },
  })))

  createEffect(() => connections().forEach((connection) => {
    const server = ServerConnection.key(connection)
    const ctx = global.ensureServerCtx(connection)
    onCleanup(ctx.data.on("session.inbox.enqueued", (event) => {
      const key = tabKey({ type: "session", server, sessionId: event.data.sessionID })
      const item = event.data.item

      if (item.type !== "move" || pathKey(state.moving[key]?.directory ?? "") !== pathKey(item.payload.location.directory)) return
      setState("moving", key, "inboxID", event.data.inboxID)
    }))
    onCleanup(ctx.data.on("session.moved", (event) => {
      const key = tabKey({ type: "session", server, sessionId: event.data.sessionID })

      if (pathKey(state.moving[key]?.directory ?? "") === pathKey(event.data.location.directory)) setState("moving", key, undefined)

      if (!props.tabs.some((tab) => tabKey(tab) === key)) return
      const project = projectFor({ type: "session", server, sessionId: event.data.sessionID })
      const directory = project?.worktree ?? event.data.location.directory
      ctx.projects.open(directory)
      ctx.projects.expand(directory)
    }))
    onCleanup(ctx.data.on("session.inbox.cancelled", (event) => {
      const key = tabKey({ type: "session", server, sessionId: event.data.sessionID })

      if (state.moving[key]?.inboxID === event.data.inboxID) setState("moving", key, undefined)
    }))
  }))

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Promise rejection is an untyped boundary; only a native Error message is displayed.
  const fail = (error: unknown) => showToast({
    title: language.t("common.requestFailed"),
    description: error instanceof Error ? error.message : undefined,
  })

  const connect = (connection: ServerConnection.Any, directory: string) => {
    const ctx = global.ensureServerCtx(connection)
    ctx.projects.open(directory)
    ctx.projects.touch(directory)
    ctx.sync.child(directory)
  }

  const add = (connection: ServerConnection.Any) => pick({
    server: connection, title: language.t("sidebar.projects.add"),
    onSelect: (value) => {
      const directory = Array.isArray(value) ? value[0] : value

      if (directory) connect(connection, directory)
    },
  })

  const create = (connection: ServerConnection.Any) => pick({
    server: connection, title: language.t("sidebar.projects.chooseParent"),
    onSelect: (value) => {
      const parent = Array.isArray(value) ? value[0] : value

      if (!parent) return
      dialog.show(() => <ProjectNameDialog parent={parent} save={async (name) => {
        const input = Schema.decodeUnknownOption(Project.CreateInput)({ parent, name })

        if (Option.isNone(input)) throw new Error(language.t("sidebar.projects.invalidName"))
        const created = await global.ensureServerCtx(connection).sdk.api.project.create(input.value)
        connect(connection, created.directory)
      }} />)
    },
  })

  const move = async (tab: Tab, destination: string) => {
    const ctx = context(tab.server)

    if (!ctx || pathKey(directory(tab) ?? "") === pathKey(destination)) return

    if (tab.type === "draft") {
      tabs.updateDraft(tab.draftID, { directory: destination, worktree: undefined, branch: undefined, mcp: undefined })
      ctx.projects.expand(destination)

      return
    }

    const key = tabKey(tab)
    const request = Symbol()
    setState("moving", key, { directory: destination, request, inboxID: undefined })
    await ctx.sdk.api.session.move({ sessionID: tab.sessionId, directory: destination }).then(async () => {
      ctx.data.session.invalidate(tab.sessionId)
      ctx.data.session.pending.invalidate(tab.sessionId)
      await Promise.all([ctx.data.session.sync(tab.sessionId), ctx.data.session.pending.sync(tab.sessionId)])

      if (state.moving[key]?.request !== request) return

      const pending = ctx.data.session.pending.list(tab.sessionId).find((item) =>
        item.type === "move" && pathKey(item.payload.location.directory) === pathKey(destination),
      )

      if (pathKey(directory(tab) ?? "") === pathKey(destination)) {
        setState("moving", key, undefined)

        return
      }

      if (pending) setState("moving", key, "inboxID", pending.id)
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The Promise rejection boundary reports errors without interpreting arbitrary payloads.
    }).catch((error: unknown) => {
      if (state.moving[key]?.request === request) setState("moving", key, undefined)
      fail(error)
    })
  }

  const moving = (tab: Tab) => {
    if (tab.type === "draft") return undefined

    const pending = context(tab.server)?.data.session.pending.list(tab.sessionId)
      .filter((item) => item.type === "move").at(-1)

    return pending?.type === "move" ? pending.payload.location.directory : state.moving[tabKey(tab)]?.directory
  }

  const drag = (tab: Tab) => ({
    draggable: true,
    onDragStart: (event: DragEvent) => {
      event.dataTransfer?.setData("text/plain", tabKey(tab))

      if (event.dataTransfer) event.dataTransfer.effectAllowed = event.dataTransfer.types.includes(SESSION_REFERENCE_MIME) ? "copyMove" : "move"
      setState("drag", tabKey(tab))
    },
    onDragEnd: () => setState({ drag: "", over: "" }),
  })

  const renderTab = (tab: Tab) => {
    const key = tabKey(tab)
    useTabShortcut(() => orderedTabs().findIndex((item) => tabKey(item) === key), () => props.onNavigate(tab))
    const ctx = () => context(tab.server)

    const destinations = () => ctx()?.projects.list().filter((project) =>
      pathKey(project.worktree) !== pathKey(directory(tab) ?? ""),
    ).map((project) => ({ worktree: project.worktree, name: displayName(project) })) ?? []

    return (
      <div class="min-w-0 ps-3">
        <Show when={tab.type === "session"} fallback={tab.type === "draft" && <DraftTabSlot
          tab={tab} id={key} index={orderedTabs().indexOf(tab)} active={props.currentTab === tab}
          orientation="vertical" title={language.t("session.tab.session")} drag={drag(tab)}
          onNavigate={(element) => props.onNavigate(tab, element)} onClose={() => props.onClose(tab)}
        />}>
          {tab.type === "session" && <SessionTabEntry
            tab={tab} id={key} index={orderedTabs().indexOf(tab)} active={props.currentTab === tab}
            orientation="vertical" serverCtx={ctx()} drag={drag(tab)}
            onTitleDragStart={drag(tab).onDragStart}
            onVisibleChange={(visible) => setState("visible", key, visible)}
            onNavigate={(element) => props.onNavigate(tab, element)} onClose={() => props.onClose(tab)}
            move={{ projects: destinations(), select: (destination) => void move(tab, destination) }}
          />}
        </Show>
        <Show when={moving(tab)}>
          {(destination) => <Tooltip value={language.t("sidebar.projects.movingHint")} placement="right">
            <p role="status" tabindex="0" class="truncate ps-1.5 text-[12px] leading-4 text-v2-text-text-accent">
              <bdi dir="auto">{language.t("sidebar.projects.moving", { name: displayName(ctx()?.projects.list().find((project) => pathKey(project.worktree) === pathKey(destination())) ?? { worktree: destination() }) })}</bdi>
            </p>
          </Tooltip>}
        </Show>
      </div>
    )
  }

  const actions = (connection: ServerConnection.Any) => <>
    <Menu.Item onSelect={() => create(connection)}>{language.t("sidebar.projects.create")}</Menu.Item>
    <Menu.Item onSelect={() => add(connection)}>{language.t("sidebar.projects.add")}</Menu.Item>
  </>

  return (
    <div data-slot="vertical-tabs" class="flex min-h-0 flex-1 flex-col [app-region:no-drag]">
      <div data-slot="vertical-tabs-scroll" class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <For each={groups()}>{(group) => <section aria-label={serverName(group.connection)}>
          <Menu.Context>
            <Menu.Context.Trigger as="div" class="flex h-8 min-w-0 items-center gap-1 ps-1.5 pe-1">
              <span class="min-w-0 flex-1 truncate text-[13px] leading-4 text-v2-text-text-muted">
                {connections().length > 1 ? serverName(group.connection) : language.t("sidebar.projects.title")}
              </span>
              <Menu>
                <Menu.Trigger as={IconButton} size="small" variant="ghost-muted" icon={<Icon name="plus" />}
                  aria-label={language.t("sidebar.projects.create")} />
                <Menu.Portal><Menu.Content>{actions(group.connection)}</Menu.Content></Menu.Portal>
              </Menu>
            </Menu.Context.Trigger>
            <Menu.Context.Portal><Menu.Context.Content>{actions(group.connection)}</Menu.Context.Content></Menu.Context.Portal>
          </Menu.Context>
          <For each={group.projects()}>{(project) => {
            const name = () => displayName(project)
            const key = () => `${group.server}\n${project.worktree}`

            return <div
              class="min-w-0 rounded-md"
              classList={{ "bg-v2-background-bg-layer-02": state.over === key() }}
              onDragOver={(event) => {
                const source = props.tabs.find((tab) => tabKey(tab) === state.drag)

                if (!source || source.server !== group.server) return
                event.preventDefault()

                if (event.dataTransfer) event.dataTransfer.dropEffect = "move"
                setState("over", key())
              }}
              onDragLeave={(event) => {
                if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
                setState("over", "")
              }}
              onDrop={(event) => {
                event.preventDefault()
                const source = props.tabs.find((tab) => tabKey(tab) === state.drag)
                setState({ drag: "", over: "" })

                if (!source || source.server !== group.server) return
                const targetKey = event.target instanceof Element ? event.target.closest("[data-tab-key]")?.getAttribute("data-tab-key") : undefined
                const target = props.tabs.find((tab) => tabKey(tab) === targetKey)

                if (target === source) return

                if (target && group.tabsFor(project.worktree).includes(source)) {
                  const next = [...props.tabs]
                  next.splice(next.indexOf(source), 1)
                  next.splice(next.indexOf(target), 0, source)
                  props.onReorder(next.map(tabKey))

                  return
                }

                void move(source, project.worktree)
              }}
            >
              <Menu.Context>
                <Menu.Context.Trigger as="button" type="button" aria-expanded={project.expanded}
                  class="flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md ps-1.5 pe-2 text-start text-[13px] leading-4 text-v2-text-text-muted hover:bg-v2-background-bg-layer-01"
                  onClick={() => project.expanded ? group.ctx.projects.collapse(project.worktree) : group.ctx.projects.expand(project.worktree)}>
                  <Icon name={project.expanded ? "chevron-down" : "chevron-right"} class="shrink-0" classList={{ "rtl:rotate-180": !project.expanded }} />
                  <Icon name="folder" class="shrink-0" />
                  <bdi dir="auto" class="min-w-0 flex-1 truncate">{name()}</bdi>
                  <Show when={project.pinned}><Icon name="pin" class="shrink-0" /></Show>
                </Menu.Context.Trigger>
                <Menu.Context.Portal><Menu.Context.Content>
                  <Menu.Item onSelect={() => {
                    group.ctx.projects.expand(project.worktree)
                    void tabs.newDraft({ server: group.server, directory: project.worktree }, "")
                  }}>
                    {language.t("command.session.new")}
                  </Menu.Item>
                  <Menu.Item onSelect={() => dialog.show(() => <ProjectNameDialog name={name()} save={async (name) => {
                    if (project.id && project.id !== "global") {
                      const updated = await group.ctx.sdk.api.project.update({ projectID: project.id, name })
                      group.ctx.sync.project.update(updated)

                      return
                    }

                    group.ctx.sync.project.meta(project.worktree, { name })
                  }} />)}>{language.t("sidebar.projects.rename")}</Menu.Item>
                  <Menu.Item onSelect={() => group.ctx.projects.pin(project.worktree, !project.pinned)}>
                    {language.t(project.pinned ? "sidebar.projects.unpin" : "sidebar.projects.pin")}
                  </Menu.Item>
                  <Show when={reveal.available(group.connection)}><Menu.Item onSelect={() => reveal.reveal(group.connection, project)}>
                    {language.t(fileManagerApp(platform.platform === "desktop" ? platform.os ?? "unknown" : "unknown").actionLabel)}
                  </Menu.Item></Show>
                  <Menu.Item onSelect={() => void (platform.writeClipboardText?.(project.worktree) ?? navigator.clipboard.writeText(project.worktree)).catch(fail)}>
                    {language.t("sidebar.projects.copyPath")}
                  </Menu.Item>
                  <Menu.Separator />
                  {actions(group.connection)}
                  <Menu.Separator />
                  <Menu.Item onSelect={() => group.ctx.projects.close(project.worktree)}>{language.t("sidebar.projects.remove")}</Menu.Item>
                </Menu.Context.Content></Menu.Context.Portal>
              </Menu.Context>
              <Show when={project.expanded}><For each={group.tabsFor(project.worktree)}>{renderTab}</For></Show>
            </div>
          }}</For>
          <Show when={group.other().length}>
            <p class="px-1.5 py-1 text-[13px] leading-4 text-v2-text-text-muted">{language.t("sidebar.projects.other")}</p>
            <For each={group.other()}>{renderTab}</For>
          </Show>
        </section>}</For>
      </div>
    </div>
  )
}
