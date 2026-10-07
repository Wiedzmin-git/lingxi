import { expect, test, type Page } from "@playwright/test"
import type { OpenCodeEvent, SessionMessageInfo } from "@opencode/client/promise"
import {
  NO_PROVIDER,
  REMOTE_SERVER,
  SERVER,
  expectPath,
  holdRoute,
  project,
  seed,
  session,
  sessionHref,
} from "../utils/app"
import { mockServers } from "../utils/mock-server"
import { installSseTransport } from "../utils/sse-transport"
import { fixture, mockStressTimeline } from "../utils/session-fixture"
import { fileNode, mockWorkspace, openSession } from "../utils/workspace"
import { expectSessionTitle, expectStoredPrompt } from "../utils/waits"
import { mockBranchReception } from "../utils/branch-reception"

const a = { id: "ses_tab_a", title: "Tab A session" }

const b = { id: "ses_tab_b", title: "Tab B session" }

const c = { id: "ses_tab_c", title: "Tab C session" }

test("external reception indicator follows this branch's grant, wake policy, listener and revocation without changing drag or selection", async ({ page }, testInfo) => {
  test.setTimeout(120000)
  const dense = Array.from({ length: 12 }, (_, index) => ({ id: `ses_reception_dense_${index}`, title: `Reception density ${index}` }))

  const status = await mockBranchReception(page, {
    [a.id]: { listener: "ready", branchAddress: { active: false, wake: false } },
    [b.id]: { listener: "ready", branchAddress: { active: true, wake: false } },
  })

  await mockWorkspace(page, { name: "Reception", sessions: [a, b, ...dense] })
  await page.goto(`/e2e/utils/windows-menu.html?${new URLSearchParams({ server: SERVER, mailbox: "1", reception: "1" })}`)
  await expect.poll(() => status.requests.some((request) => request.sessionID === dense[0].id)).toBe(true)
  expect(status.requests.some((request) => request.sessionID === b.id)).toBe(false)
  await page.locator('[data-component="home-session-row"]').filter({ hasText: b.title }).scrollIntoViewIfNeeded()
  await expect(page.locator('[data-component="home-session-row"]').filter({ hasText: b.title }).getByRole("img", { name: /External requests allowed.*queue only/ })).toBeVisible()
  await expect(page.locator('[data-component="home-session-row"]').filter({ hasText: a.title }).getByRole("img", { name: /External requests/ })).toHaveCount(0)
  await page.locator('[data-component="home-session-row"]').filter({ hasText: b.title }).click()
  await page.getByRole("button", { name: "Home", exact: true }).click()
  await page.locator('[data-component="home-session-row"]').filter({ hasText: a.title }).click()
  const slot = (id: string) => page.locator(`[data-titlebar-tab-slot]:has(a[href$="/session/${id}"])`)
  await expect(slot(b.id).locator("[data-titlebar-tab-title]")).toHaveText(b.title)
  await expect(slot(a.id)).toHaveAttribute("data-active", "true")
  await expect(slot(b.id).getByRole("img", { name: /External requests allowed.*queue only/ })).toBeVisible()
  await expect(slot(a.id).getByRole("img", { name: /External requests/ })).toHaveCount(0)
  await expect(slot(b.id).getByTitle("Drag branch reference into a prompt", { exact: true })).toHaveAttribute("draggable", "true")
  await expect(slot(b.id).locator("[data-titlebar-tab-title]")).toHaveAttribute("draggable", "true")
  const receptionGlyph = await slot(b.id).getByRole("img", { name: /External requests allowed/ }).locator("use").getAttribute("href")
  expect(receptionGlyph).not.toBe("#opencode-v2-icon-link")
  const editor = page.locator('[data-component="composer-editor"][contenteditable="true"]')
  await expect(editor).toBeEditable()
  await editor.fill("Reception drag remains available ")
  await slot(b.id).getByTitle("Drag branch reference into a prompt", { exact: true }).dragTo(editor)
  await slot(b.id).locator("[data-titlebar-tab-title]").dragTo(editor)
  await expect(editor.locator('[data-mention="session"]')).toHaveCount(2)

  for (const chip of await editor.locator('[data-mention="session"]').all()) await expect(chip).toHaveAttribute("title", b.id)
  await expect(slot(a.id)).toHaveAttribute("data-active", "true")
  await expect(slot(b.id).getByRole("img", { name: /External requests allowed.*queue only/ })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("reception-wide.png") })

  for (const [value, label] of [
    [{ listener: "ready", branchAddress: { active: true, wake: true } }, /External requests allowed.*wake and steer allowed/],
    [{ listener: "disabled", branchAddress: { active: true, wake: true } }, /External requests permitted.*listener unavailable.*disabled/],
    [{ error: "r2_host_unavailable" }, undefined],
    [{ listener: "ready", branchAddress: { active: true, wake: false } }, /External requests allowed.*queue only/],
    [{ listener: "ready", branchAddress: { active: false, wake: false } }, undefined],
  ] as const) {
    await status.update(b.id, value)

    if (label) await expect(slot(b.id).getByRole("img", { name: label })).toBeVisible()
    else await expect(slot(b.id).getByRole("img", { name: /External requests/ })).toHaveCount(0)
    await expect(slot(a.id).getByRole("img", { name: /External requests/ })).toHaveCount(0)
    await expect(slot(a.id)).toHaveAttribute("data-active", "true")
  }

  expect(status.requests.some((request) => request.sessionID === b.id && request.server === "sidecar")).toBe(true)
  await expect(slot(b.id).getByTitle("Drag branch reference into a prompt", { exact: true })).toHaveAttribute("draggable", "true")
  await status.update(b.id, { listener: "ready", branchAddress: { active: true, wake: false } })
  await expect(slot(b.id).getByRole("img", { name: /External requests allowed.*queue only/ })).toBeVisible()
  await page.getByRole("button", { name: "Home", exact: true }).click()

  for (const item of dense) await page.locator('[data-component="home-session-row"]').filter({ has: page.getByText(item.title, { exact: true }) }).click({ modifiers: ["Control"] })
  await page.locator('[data-component="home-session-row"]').filter({ hasText: a.title }).click()
  await page.setViewportSize({ width: 1280, height: 720 })
  await expect(slot(b.id).getByRole("img", { name: /External requests allowed/ })).toBeInViewport({ ratio: 1 })
  await expect.poll(() => slot(b.id).evaluate((element) => {
    const container = element.querySelector('[data-titlebar-tab]')

    if (!container) return false
    const style = getComputedStyle(container)
    const width = container.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth)
    const link = element.querySelector("[data-titlebar-tab-link]")

    return width > 44 && width <= 64 && !!link && getComputedStyle(link).maskImage === "none"
  })).toBe(true)
  await page.screenshot({ path: testInfo.outputPath("reception-medium.png") })
  await page.setViewportSize({ width: 768, height: 720 })
  await expect(slot(b.id).getByRole("img", { name: /External requests allowed/ })).toBeInViewport({ ratio: 1 })
  await expect.poll(() => slot(b.id).evaluate((element) => {
    const box = element.getBoundingClientRect()
    const children = [element.querySelector('[data-session-reference-drag]'), element.querySelector('[role="img"]')]

    return box.width <= 44 && children.every((child) => {
      if (!child) return false
      const bounds = child.getBoundingClientRect()

      return bounds.left >= box.left && bounds.right <= box.right && bounds.top >= box.top && bounds.bottom <= box.bottom
    })
  })).toBe(true)
  await page.screenshot({ path: testInfo.outputPath("reception-compact.png") })
})

test.use({ serviceWorkers: "block" })

test("copies the selected inactive tab ID without switching or mutating the session", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  await mockWorkspace(page, { name: "Tabs", sessions: [a, b] })
  await page.goto(sessionHref(a.id))
  const title = page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(b.id)}"]) [data-slot="tab-title"]`)
  await expect(title).toHaveText(b.title)
  await title.click({ button: "right" })
  await page.getByRole("menuitem", { name: "Copy Session ID", exact: true }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(b.id)
  await expectPath(page, sessionHref(a.id))
  await expect(title).toHaveText(b.title)
})

test("tab strip keeps draft tabs as wide as session tabs and distinguishes a title click from a drag", async ({ page }) => {
  const workspace = await mockWorkspace(page, {
    name: "Tabs",
    sessions: [a, b],
    seed: { tabs: [a.id, { draft: "draft_tab_width", directory: "C:/OpenCode/Tabs" }, b.id] },
  })

  await page.goto(sessionHref(a.id))

  const tabs = page.locator("[data-titlebar-tab-slot]")
  await expect(tabs.locator("[data-titlebar-tab-title]")).toHaveText([a.title, "Session", b.title])
  await expect
    .poll(() =>
      tabs.evaluateAll((tabs) => {
        const widths = tabs.map((tab) => tab.getBoundingClientRect().width)

        return Math.max(...widths) - Math.min(...widths)
      }),
    )
    .toBeLessThan(1)

  const title = page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(b.id, workspace.server)}"]) [data-titlebar-tab-title]`)
  await title.hover()
  await page.mouse.down()
  await expectPath(page, sessionHref(a.id))
  await page.mouse.up()
  await expectPath(page, sessionHref(b.id))
})

for (const tabLayout of ["horizontal", "vertical"] as const) {
  test(`dragging a branch title within the tab list reorders without switching (${tabLayout})`, async ({ page }) => {
    await openSession(page, { name: "TitleReorder", sessionID: a.id, sessions: [a, b, c],
      seed: { settings: { appearance: { tabLayout } } } })
    const source = page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(c.id)}"]) [data-titlebar-tab-title]`)
    const target = page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(a.id)}"]) [data-titlebar-tab-title]`)
    await source.dragTo(target)
    await expect(page.locator('[data-titlebar-tab-slot] [data-titlebar-tab-title]')).toHaveText([c.title, a.title, b.title])
    await expectPath(page, sessionHref(a.id))
    await page.reload()
    await expect(page.locator('[data-titlebar-tab-slot] [data-titlebar-tab-title]')).toHaveText([c.title, a.title, b.title])
  })
}

test("branch mail keeps its header and close control on screen while the form and long mail list scroll", async ({ page }) => {
  const title = `Mailbox scroll fixture ${"LongBranchName".repeat(9)}`
  await page.setViewportSize({ width: 1000, height: 836 })
  await mockWorkspace(page, { name: "MailboxScroll", sessions: [{ id: "ses_mailbox_scroll", title }] })
  await page.goto(`/e2e/utils/windows-menu.html?${new URLSearchParams({ server: SERVER, mailbox: "1" })}`)
  const row = page.locator('[data-component="home-session-row"]').filter({ hasText: "Mailbox scroll fixture" })
  await row.click({ button: "right" })
  await page.getByRole("menuitem", { name: "Branch mail…", exact: true }).click()
  await page.setViewportSize({ width: 477, height: 836 })
  const dialog = page.getByRole("dialog", { name: `Branch mail — ${title}`, exact: true })
  const body = dialog.locator('[data-slot="dialog-body"]')
  const close = dialog.getByRole("button", { name: "Close", exact: true })
  const fits = () => dialog.evaluate((element) => {
    const box = element.getBoundingClientRect()
    return box.top >= 0 && box.left >= 0 && box.bottom <= innerHeight && box.right <= innerWidth
  })
  await expect.poll(fits).toBe(true)
  await expect.poll(() => body.evaluate((element) => element.scrollHeight > element.clientHeight && getComputedStyle(element).overflowY === "auto")).toBe(true)
  await body.hover()
  await page.mouse.wheel(0, 100000)
  await expect(dialog.getByText("Mailbox scroll end", { exact: true })).toBeInViewport()
  await expect(close).toBeInViewport()
  await expect.poll(() => close.evaluate((element) => {
    const box = element.getBoundingClientRect()
    return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight
  })).toBe(true)
  const message = dialog.getByLabel("Message", { exact: true })
  await message.scrollIntoViewIfNeeded()
  await message.fill("Keep message while scrolling")
  const settings = dialog.locator("summary").filter({ hasText: "LAN mailbox settings" })
  await settings.scrollIntoViewIfNeeded()
  await settings.click()
  const published = dialog.getByLabel("Published computer name (optional; defaults to bind IPv4)", { exact: true })
  await published.fill("CO_FIN05")
  await expect(dialog.getByLabel("Enable LAN communication", { exact: true })).not.toBeChecked()
  await page.setViewportSize({ width: 477, height: 420 })
  await expect.poll(fits).toBe(true)
  await message.scrollIntoViewIfNeeded()
  await expect(message).toHaveValue("Keep message while scrolling")
  await published.scrollIntoViewIfNeeded()
  await expect(published).toHaveValue("CO_FIN05")
  await body.hover()
  await page.mouse.wheel(0, 100000)
  await expect(dialog.getByText("Mailbox scroll end", { exact: true })).toBeInViewport()
  await expect(close).toBeInViewport()
  await close.click()
  await expect(dialog).toBeHidden()
})

test("a tab does not reopen its title editor while a rename is saving", async ({ page }) => {
  await mockWorkspace(page, { name: "Tabs", sessions: [a, b] })
  await page.goto(sessionHref(a.id))
  const title = page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(a.id)}"]) [data-slot="tab-title"]`)
  const editor = page.locator('[data-slot="tab-title"][contenteditable="true"]')
  await expect(title).toHaveText(a.title)
  const save = await holdRoute(page, (url) => url.pathname === `/api/session/${a.id}`, { method: "PATCH" })

  await title.dblclick()
  await expect(editor).toBeFocused()
  await editor.fill("Renamed tab")
  await editor.press("Enter")
  expect((await save.arrived).postDataJSON()).toEqual({ title: "Renamed tab" })
  await expect(editor).toHaveCount(0)
  await title.dblclick()
  await expect(editor).toHaveCount(0)

  // The context menu's Rename item is enabled again once the save settles.
  save.release()
  await title.click({ button: "right" })
  await expect(page.getByRole("menuitem", { name: "Rename", exact: true })).toBeEnabled()
  await page.keyboard.press("Escape")
  await title.dblclick()
  await expect(editor).toBeFocused()
})

test("keyboard navigation follows the visible tab order and skips unresolved tabs", async ({ page }) => {
  await mockWorkspace(page, { name: "Tabs", sessions: [a, c], seed: { tabs: [a.id, "ses_tab_unresolved", c.id] } })
  await page.route(
    (url) => url.pathname === "/api/session/ses_tab_unresolved",
    () => new Promise(() => {}),
  )
  await page.goto(sessionHref(a.id))
  await expect(page.locator("[data-titlebar-tab-slot]:visible")).toHaveCount(2)
  await expect(page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(c.id)}"])`)).toBeVisible()

  await page.keyboard.press("Control+Alt+ArrowRight")

  await expectPath(page, sessionHref(c.id))
})

for (const row of [
  { tabLayout: "horizontal", width: 360 },
  { tabLayout: "vertical", width: 390 },
]) {
  test(`mobile drawer exposes close controls and navigates between tabs (${row.tabLayout})`, async ({ page }) => {
    await page.setViewportSize({ width: row.width, height: 720 })
    await mockWorkspace(page, {
      name: "Tabs",
      sessions: [a, b, c],
      seed: { settings: { appearance: { tabLayout: row.tabLayout } } },
    })
    await page.goto(sessionHref(a.id))
    await page.getByRole("button", { name: "Tabs", exact: true }).click()

    const drawer = page.locator('[data-slot="mobile-tabs-drawer"]')
    const tabA = drawer.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(a.id)}"])`)
    const tabB = drawer.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(b.id)}"])`)
    await expect(tabA).toHaveAttribute("data-active", "true")
    await expect(tabA.locator('[data-slot="tab-close"]')).toBeVisible()
    await expect(tabB.locator('[data-slot="tab-close"]')).toBeVisible()
    await expect(page.locator('[data-slot="vertical-tabs-sidebar"]')).toHaveCount(0)

    // The drawer already reserves space for close controls; fading its active
    // title again hides readable text. The layout table needs this check once.
    if (row.tabLayout === "horizontal") await expect(tabA.locator('[data-slot="tab-title"]')).toHaveCSS("mask-image", "none")

    await tabB.locator(`a[href="${sessionHref(b.id)}"]`).click()

    await expectPath(page, sessionHref(b.id))
    await expect(page.getByRole("dialog", { name: "Tabs", exact: true })).toBeHidden()

    if (row.tabLayout !== "vertical") return
    await page.setViewportSize({ width: 1280, height: 720 })
    await expect(
      page
        .locator('[data-slot="vertical-tabs-sidebar"]')
        .locator(`[data-titlebar-tab-link][href="${sessionHref(b.id)}"]`),
    ).toBeVisible()
    await expect(page.locator('[data-slot="titlebar-tabs"]')).toHaveCount(0)
  })
}

test("vertical tabs resize, scroll, show shortcut hints, and navigate", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 480 })
  const directory = "C:/OpenCode/Tabs"
  await mockWorkspace(page, {
    name: "Tabs",
    sessions: [a, b],
    seed: {
      settings: {
        appearance: { tabLayout: "vertical" },
        keybinds: { "home.toggle": "ctrl+alt+h", "tab.new": "ctrl+shift+n" },
      },
      tabs: [
        a.id,
        ...Array.from({ length: 24 }, (_, index) => ({ draft: `draft_vertical_${index}`, directory })),
        b.id,
      ],
    },
  })
  await page.goto(sessionHref(a.id))

  const sidebar = page.locator('[data-slot="vertical-tabs-sidebar"]')
  const tabB = sidebar.locator(`[data-titlebar-tab-link][href="${sessionHref(b.id)}"]`)
  await expect(sidebar.locator("[data-titlebar-tab-slot]")).toHaveCount(26)
  await expect(sidebar).toHaveCSS("width", "260px")
  await expect(page.locator('[data-slot="titlebar-tabs"]')).toHaveCount(0)

  const handle = sidebar.locator('[data-component="resize-handle"]')

  for (const [offset, width] of [
    [-80, "180px"],
    [-200, "140px"],
  ] as const) {
    const box = await handle.boundingBox()

    if (!box) throw new Error("vertical tab resize handle has no bounding box")
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + offset, box.y + box.height / 2)
    await page.mouse.up()
    await expect(sidebar).toHaveCSS("width", width)
  }

  for (const name of ["Home", "New session"]) {
    const label = sidebar.getByRole("button", { name, exact: true }).getByText(name, { exact: true })
    await expect(label).toBeVisible()
    await expect
      .poll(() => label.evaluate((element) => element.scrollWidth - element.clientWidth), { message: name })
      .toBeLessThanOrEqual(1)
  }

  const scroll = sidebar.locator('[data-slot="vertical-tabs-scroll"]')
  await scroll.evaluate((element) => element.scrollTo(0, element.scrollHeight))
  await expect(tabB).toBeInViewport({ ratio: 1 })

  await page.locator("html").evaluate((element) => element.setAttribute("dir", "rtl"))
  const home = sidebar.locator('[data-action="vertical-tabs-home"]')
  const hint = home.locator('span[aria-hidden="true"]')
  await expect(hint).toHaveText("Ctrl+Alt+H")
  await expect(hint.getByText("Ctrl+Alt+H", { exact: true })).toHaveCSS("direction", "ltr")
  await expect(hint).toBeHidden()
  await home.focus()
  await expect(hint).toBeVisible()

  await tabB.click()
  await expectPath(page, sessionHref(b.id))
})

const projectA = "C:/OpenCode/SidebarAlpha"

const projectB = "C:/OpenCode/SidebarBeta"

test("project sidebar reconciles moves missed while a source project is collapsed and disconnected", async ({ page }) => {
  const inbox: unknown[] = []
  const transport = await installSseTransport(page, { server: SERVER })

  const workspace = await mockWorkspace(page, {
    name: "SidebarAlpha", directory: projectA, project: { id: "proj_sidebar_a" },
    projects: [project({ id: "proj_sidebar_a", directory: projectA }), project({ id: "proj_sidebar_b", directory: projectB })],
    sessions: [a, { ...b, directory: projectB, projectID: "proj_sidebar_b" }],
    inbox: () => inbox,
    onSessionMove: () => inbox.push({ id: "inb_sidebar_reconnect", sessionID: a.id, time: { created: 1 }, type: "move", payload: { location: { directory: projectB }, projectID: "proj_sidebar_b" }, delivery: "steer" }),
    seed: {
      settings: { appearance: { tabLayout: "vertical" } },
      projects: { local: [{ worktree: projectA, expanded: true }, { worktree: projectB, expanded: true }] },
    },
  })

  await page.goto(sessionHref(b.id))
  const sidebar = page.locator('[data-slot="vertical-tabs-sidebar"]')
  const alpha = sidebar.getByRole("button", { name: "SidebarAlpha", exact: true })
  const beta = sidebar.getByRole("button", { name: "SidebarBeta", exact: true })
  const connection = await transport.waitForConnection()
  await sidebar.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(a.id)}"])`).dragTo(beta)
  await expect(sidebar.getByRole("status")).toHaveText("Moving to SidebarBeta…")
  await alpha.click()
  await expect(alpha).toHaveAttribute("aria-expanded", "false")
  await transport.disconnect()
  workspace.sessions[0]!.directory = projectB
  workspace.sessions[0]!.projectID = "proj_sidebar_b"
  inbox.splice(0)
  await transport.waitForConnection({ after: connection.id })
  await expect(beta.locator("..").locator("[data-titlebar-tab-title]")).toHaveText([a.title, b.title])
  await expect(sidebar.getByRole("status")).toHaveCount(0)
  await expect(alpha).toHaveAttribute("aria-expanded", "false")
})

test("project sidebar keeps the newer move marker when an earlier request fails", async ({ page }) => {
  const destination = "C:/OpenCode/SidebarGamma"
  const first = Promise.withResolvers<void>()
  const second = Promise.withResolvers<void>()
  const calls: string[] = []
  const workspace = await mockWorkspace(page, {
    name: "SidebarAlpha", directory: projectA, project: { id: "proj_sidebar_a" }, sessions: [a],
    projects: [project({ id: "proj_sidebar_a", directory: projectA }), project({ id: "proj_sidebar_b", directory: projectB }), project({ id: "proj_sidebar_c", directory: destination })],
    seed: {
      settings: { appearance: { tabLayout: "vertical" } },
      projects: { local: [{ worktree: projectA, expanded: true }, { worktree: projectB, expanded: true }, { worktree: destination, expanded: true }] },
    },
  })
  await page.route(`**/api/session/${a.id}/move`, async (route) => {
    const index = calls.length
    calls.push(route.request().url())
    await (index === 0 ? first.promise : second.promise)
    await route.fulfill(index === 0 ? { status: 500, json: { message: "Earlier move failed" } } : { status: 204 })
  })

  await page.goto(sessionHref(a.id))
  const sidebar = page.locator('[data-slot="vertical-tabs-sidebar"]')
  const tab = sidebar.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(a.id)}"])`)
  await tab.dragTo(sidebar.getByRole("button", { name: "SidebarBeta", exact: true }))
  await expect.poll(() => calls.length).toBe(1)
  await expect(sidebar.getByRole("status")).toHaveText("Moving to SidebarBeta…")
  await tab.dragTo(sidebar.getByRole("button", { name: "SidebarGamma", exact: true }))
  await expect.poll(() => calls.length).toBe(2)
  await expect(sidebar.getByRole("status")).toHaveText("Moving to SidebarGamma…")
  const failed = page.waitForResponse((response) => response.url().endsWith(`/api/session/${a.id}/move`) && response.status() === 500)
  first.resolve()
  await failed
  await expect(page.getByText("Request failed", { exact: true })).toBeVisible()
  await expect(sidebar.getByRole("status")).toHaveText("Moving to SidebarGamma…")
  const admitted = page.waitForResponse((response) => response.url().endsWith(`/api/session/${a.id}/move`) && response.status() === 204)
  second.resolve()
  await admitted
  await expect(sidebar.getByRole("status")).toHaveText("Moving to SidebarGamma…")
  workspace.sessions[0]!.directory = destination
  workspace.sessions[0]!.projectID = "proj_sidebar_c"
  await workspace.push([{ id: "evt_newer_move_placed", created: 5, type: "session.moved", durable: { aggregateID: a.id, seq: 1, version: 1 }, data: { sessionID: a.id, location: { directory: destination }, projectID: "proj_sidebar_c" } }])
  await expect(sidebar.getByRole("status")).toHaveCount(0)
})

test("project sidebar persists display names, pinning and collapse without renaming or deleting folders", async ({ page }) => {
  const inventory = [project({ id: "proj_sidebar_a", directory: projectA }), project({ id: "proj_sidebar_b", directory: projectB })]
  const edits: unknown[] = []
  const deletes: string[] = []
  page.on("request", (request) => {
    if (request.method() === "DELETE") deletes.push(request.url())
  })
  await mockWorkspace(page, {
    name: "SidebarAlpha", directory: projectA,
    project: { id: "proj_sidebar_a" },
    projects: () => inventory,
    sessions: [a, { ...b, directory: projectB, projectID: "proj_sidebar_b" }],
    onProjectUpdate: (input) => {
      edits.push(input)
      inventory[1] = { ...inventory[1]!, name: "Beta display name" }

      return inventory[1]
    },
    seed: {
      settings: { appearance: { tabLayout: "vertical" } },
      projects: { local: [{ worktree: projectA, expanded: true }, { worktree: projectB, expanded: true }] },
    },
  })
  await page.goto(sessionHref(a.id))
  const sidebar = page.locator('[data-slot="vertical-tabs-sidebar"]')
  const headers = sidebar.locator("button[aria-expanded]:has(bdi)")
  const beta = sidebar.getByRole("button", { name: "SidebarBeta", exact: true })
  await expect(headers).toHaveText(["SidebarAlpha", "SidebarBeta"])
  await expect(sidebar.locator("[data-titlebar-tab-title]")).toHaveText([a.title, b.title])
  await beta.click({ button: "right" })
  await page.getByRole("menuitem", { name: "Rename project", exact: true }).click()
  const rename = page.getByRole("dialog", { name: "Rename project", exact: true })
  await rename.getByLabel("Display name", { exact: true }).fill("Beta display name")
  await rename.getByRole("button", { name: "Save", exact: true }).click()
  const renamed = sidebar.getByRole("button", { name: "Beta display name", exact: true })
  await expect(renamed).toBeVisible()
  expect(edits).toEqual([{ projectID: "proj_sidebar_b", body: { name: "Beta display name" } }])
  await renamed.click({ button: "right" })
  await page.getByRole("menuitem", { name: "Pin project", exact: true }).click()
  await expect(headers).toHaveText(["Beta display name", "SidebarAlpha"])
  await renamed.click()
  await expect(renamed).toHaveAttribute("aria-expanded", "false")
  await expect(sidebar.locator("[data-titlebar-tab-title]")).toHaveText([a.title])
  await page.reload()
  await expect(headers).toHaveText(["Beta display name", "SidebarAlpha"])
  await expect(renamed).toHaveAttribute("aria-expanded", "false")
  await renamed.click({ button: "right" })
  await expect(page.getByRole("menuitem", { name: "Unpin project", exact: true })).toBeEnabled()
  await page.getByRole("menuitem", { name: "New session", exact: true }).click()
  await expect(renamed).toHaveAttribute("aria-expanded", "true")
  await expect(renamed.locator("..").locator("[data-titlebar-tab-title]")).toHaveText([b.title, "Session"])
  await sidebar.locator('[data-titlebar-tab-slot]').filter({ has: page.getByText("Session", { exact: true }) }).getByRole("button", { name: "Close tab", exact: true }).click()
  await renamed.click({ button: "right" })
  await page.getByRole("menuitem", { name: "Remove from list", exact: true }).click()
  await expect(renamed).toHaveCount(0)
  await expect(sidebar.getByText("Other sessions", { exact: true })).toBeVisible()
  await expect(sidebar.locator("[data-titlebar-tab-title]")).toHaveText([a.title, b.title])
  expect(deletes).toEqual([])
})

test("project sidebar moves running sessions without confirmation and waits for placement, not admission", async ({ page }) => {
  const inbox: unknown[] = []
  const moves: { sessionID: string; directory: string }[] = []

  const workspace = await mockWorkspace(page, {
    name: "SidebarAlpha", directory: projectA, project: { id: "proj_sidebar_a" },
    projects: [project({ id: "proj_sidebar_a", directory: projectA }), project({ id: "proj_sidebar_b", directory: projectB })],
    sessions: [a, { ...b, directory: projectB, projectID: "proj_sidebar_b" }],
    sessionStatus: { [a.id]: { type: "running" } },
    inbox: () => inbox,
    onSessionMove: (input) => {
      moves.push(input)
      inbox.push({ id: `inb_sidebar_move_${moves.length}`, sessionID: a.id, time: { created: 1 }, type: "move", payload: { location: { directory: input.directory }, projectID: "proj_sidebar_b" }, delivery: "steer" })
    },
    seed: {
      settings: { appearance: { tabLayout: "vertical" } },
      projects: { local: [{ worktree: projectA, expanded: true }, { worktree: projectB, expanded: true }] },
    },
  })

  await page.goto(sessionHref(a.id))
  const sidebar = page.locator('[data-slot="vertical-tabs-sidebar"]')
  const tab = sidebar.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(a.id)}"])`)
  const alpha = sidebar.getByRole("button", { name: "SidebarAlpha", exact: true }).locator("..")
  const beta = sidebar.getByRole("button", { name: "SidebarBeta", exact: true }).locator("..")
  await expect(tab.locator('[data-component="session-progress-indicator-v2"]')).toBeVisible()
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true })
  await expect(prompt).toBeEditable()
  await prompt.fill("Unsent text before relocation")
  await tab.locator("[data-titlebar-tab-title]").dragTo(beta.getByRole("button", { name: "SidebarBeta", exact: true }))
  const status = sidebar.getByRole("status").filter({ hasText: "Moving to SidebarBeta…" })
  await expect(status).toBeVisible()
  expect(moves).toEqual([{ sessionID: a.id, directory: projectB }])
  await expect(alpha.locator("[data-titlebar-tab-title]")).toHaveText([a.title])
  await expect(beta.locator("[data-titlebar-tab-title]")).toHaveText([b.title])
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await status.hover()
  await expect(page.getByRole("tooltip")).toContainText("The move will be applied at the next safe boundary between execution steps.")
  await workspace.push([{ id: "evt_sidebar_unrelated_cancel", created: 2, type: "session.inbox.cancelled", durable: { aggregateID: a.id, seq: 1, version: 1 }, data: { sessionID: a.id, inboxID: "inb_unrelated" } }])
  await expect(status).toBeVisible()
  inbox.splice(0)
  await workspace.push([{ id: "evt_sidebar_cancel_move", created: 3, type: "session.inbox.cancelled", durable: { aggregateID: a.id, seq: 2, version: 1 }, data: { sessionID: a.id, inboxID: "inb_sidebar_move_1" } }])
  await expect(status).toHaveCount(0)
  await expect(alpha.locator("[data-titlebar-tab-title]")).toHaveText([a.title])

  await tab.click({ button: "right" })
  await page.getByRole("menuitem", { name: "Move to project", exact: true }).hover()
  await page.getByRole("menuitem", { name: "SidebarBeta", exact: true }).click()
  await expect(status).toBeVisible()
  expect(moves).toHaveLength(2)
  inbox.splice(0)
  await workspace.push([{ id: "evt_sidebar_delivered", created: 4, type: "session.inbox.delivered", durable: { aggregateID: a.id, seq: 3, version: 1 }, data: { sessionID: a.id, inboxID: "inb_sidebar_move_2" } }])
  await expect(status).toBeVisible()
  await expect(alpha.locator("[data-titlebar-tab-title]")).toHaveText([a.title])
  workspace.sessions[0]!.directory = projectB
  workspace.sessions[0]!.projectID = "proj_sidebar_b"
  await workspace.push([{ id: "evt_sidebar_moved", created: 5, type: "session.moved", durable: { aggregateID: a.id, seq: 4, version: 1 }, data: { sessionID: a.id, location: { directory: projectB }, projectID: "proj_sidebar_b" } }])
  await expect(status).toHaveCount(0)
  await expect(alpha.locator("[data-titlebar-tab-title]")).toHaveCount(0)
  await expect(beta.locator("[data-titlebar-tab-title]")).toHaveText([a.title, b.title])
  await expectPath(page, sessionHref(a.id))
  await expect(prompt).toHaveText("Unsent text before relocation")
  await prompt.fill("Unsent text edited after relocation")
  await expectStoredPrompt(page, "Unsent text edited after relocation")
  await page.reload()
  await expect(prompt).toBeEditable()
  await expect(prompt).toHaveText("Unsent text edited after relocation")
  await expect(beta.locator("[data-titlebar-tab-title]")).toHaveText([a.title, b.title])
  await expect(status).toHaveCount(0)
})

test("project sidebar reorders tabs and relocates unsent drafts locally", async ({ page }) => {
  const moves: unknown[] = []
  await mockWorkspace(page, {
    name: "SidebarAlpha", directory: projectA, project: { id: "proj_sidebar_a" },
    projects: [project({ id: "proj_sidebar_a", directory: projectA }), project({ id: "proj_sidebar_b", directory: projectB })],
    sessions: [{ ...a, directory: `${projectA}/alpha` }, { ...c, directory: `${projectA}/gamma` }, { ...b, directory: projectB, projectID: "proj_sidebar_b" }],
    onSessionMove: (input) => moves.push(input),
    seed: {
      settings: { appearance: { tabLayout: "vertical" } },
      projects: { local: [{ worktree: projectA, expanded: true }, { worktree: projectB, expanded: true }] },
      tabs: [a.id, c.id, { draft: "draft_sidebar", directory: projectA }, b.id],
    },
  })
  await page.goto(sessionHref(a.id))
  const sidebar = page.locator('[data-slot="vertical-tabs-sidebar"]')
  const tab = (id: string) => sidebar.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(id)}"])`)
  await expect(sidebar.locator("[data-titlebar-tab-title]")).toHaveText([a.title, c.title, "Session", b.title])
  await tab(c.id).dragTo(tab(a.id))
  await expect(sidebar.locator("[data-titlebar-tab-title]")).toHaveText([c.title, a.title, "Session", b.title])
  await tab(c.id).dragTo(tab(c.id))
  await expect(sidebar.locator("[data-titlebar-tab-title]")).toHaveText([c.title, a.title, "Session", b.title])
  const draft = sidebar.locator('[data-titlebar-tab-slot]').filter({ has: page.getByText("Session", { exact: true }) })
  const beta = sidebar.getByRole("button", { name: "SidebarBeta", exact: true }).locator("..")
  await draft.getByRole("link", { name: "Session", exact: true }).click()
  await expect(page.getByRole("button", { name: "Local", exact: true })).toBeVisible()
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true })
  await expect(prompt).toBeEditable()
  await prompt.fill("Unsent draft follows its project")
  await expectStoredPrompt(page, "Unsent draft follows its project")
  await draft.dragTo(beta.getByRole("button", { name: "SidebarBeta", exact: true }))
  await expect(beta.locator("[data-titlebar-tab-title]")).toHaveText(["Session", b.title])
  await expect(prompt).toHaveText("Unsent draft follows its project")
  await expectStoredPrompt(page, "Unsent draft follows its project")
  await page.reload()
  await expect(sidebar.locator("[data-titlebar-tab-title]")).toHaveText([c.title, a.title, "Session", b.title])
  await expect(beta.locator("[data-titlebar-tab-title]")).toHaveText(["Session", b.title])
  await expect(prompt).toHaveText("Unsent draft follows its project")
  expect(moves).toEqual([])
})

test("project sidebar keeps external worktree sessions and workspace-selection drafts in their owning project", async ({ page }) => {
  const external = "C:/Worktrees/sidebar-feature"
  await mockWorkspace(page, {
    name: "SidebarAlpha", directory: projectA, project: { id: "proj_sidebar_a", sandboxes: [external] },
    sessions: [{ ...a, directory: external }],
    fileList: () => [],
    seed: {
      settings: { appearance: { tabLayout: "vertical" } },
      tabs: [a.id, { draft: "draft_sidebar_selection", directory: projectA }],
    },
  })
  await page.goto(sessionHref(a.id))
  const sidebar = page.locator('[data-slot="vertical-tabs-sidebar"]')
  const alpha = sidebar.getByRole("button", { name: "SidebarAlpha", exact: true })
  await expect(alpha.locator("..").locator("[data-titlebar-tab-title]")).toHaveText([a.title, "Session"])
  await sidebar.getByRole("link", { name: "Session", exact: true }).click()
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeEditable()
  const workspace = page.getByRole("button", { name: "Local", exact: true })
  await workspace.click()
  await page.getByRole("menuitem", { name: "New worktree", exact: true }).click()
  await expect(page.getByRole("button", { name: "New worktree", exact: true })).toBeVisible()
  await expect(alpha.locator("..").locator("[data-titlebar-tab-title]")).toHaveText([a.title, "Session"])
  await page.getByRole("button", { name: "New worktree", exact: true }).click()
  await page.getByRole("menuitem", { name: "Local repository", exact: true }).click()
  await expect(workspace).toBeVisible()
  await expect(sidebar.getByText("Other sessions", { exact: true })).toHaveCount(0)
  await alpha.click()
  await expect(sidebar.locator("[data-titlebar-tab-slot]")).toHaveCount(0)
})

test("project sidebar creates a named child folder separately from adding an existing folder", async ({ page }) => {
  const inventory = [project({ id: "proj_sidebar_a", directory: projectA }), project({ id: "proj_sidebar_b", directory: projectB })]
  const creates: unknown[] = []
  await mockWorkspace(page, {
    name: "SidebarAlpha", directory: projectA, project: { id: "proj_sidebar_a" }, sessions: [a],
    projects: () => inventory,
    fileList: () => [],
    onProjectCreate: (input) => {
      creates.push(input)
      const directory = `${input.parent}/${input.name}`
      inventory.push(project({ id: "proj_sidebar_created", directory }))

      return { directory }
    },
    seed: { settings: { appearance: { tabLayout: "vertical" } } },
  })
  await page.goto(sessionHref(a.id))
  const sidebar = page.locator('[data-slot="vertical-tabs-sidebar"]')
  await sidebar.getByRole("button", { name: "New project…", exact: true }).click()
  await page.getByRole("menuitem", { name: "New project…", exact: true }).click()
  const parent = page.getByRole("dialog", { name: "Choose parent folder", exact: true })
  await expect(parent.getByRole("button", { name: "Select folder", exact: true })).toBeEnabled()
  await parent.getByRole("combobox").fill("C:/OpenCode")
  await parent.getByRole("combobox").press("Enter")
  await expect(parent.locator(".directory-picker-selection")).toHaveText("C:\\OpenCode")
  await expect(parent.getByRole("button", { name: "Select folder", exact: true })).toBeEnabled()
  await parent.getByRole("button", { name: "Select folder", exact: true }).click()
  const naming = page.getByRole("dialog", { name: "New project…", exact: true })
  await naming.getByLabel("Folder name", { exact: true }).fill("../outside")
  await naming.getByRole("button", { name: "Save", exact: true }).click()
  await expect(naming.getByRole("alert")).toContainText("Enter one folder name")
  expect(creates).toEqual([])
  await naming.getByLabel("Folder name", { exact: true }).fill("SidebarCreated")
  await naming.getByRole("button", { name: "Save", exact: true }).click()
  await expect(sidebar.getByRole("button", { name: "SidebarCreated", exact: true })).toBeVisible()
  expect(creates).toEqual([{ parent: "C:\\OpenCode", name: "SidebarCreated" }])
  await sidebar.getByRole("button", { name: "New project…", exact: true }).click()
  await page.getByRole("menuitem", { name: "Add existing folder…", exact: true }).click()
  const existing = page.getByRole("dialog", { name: "Add existing folder…", exact: true })
  // Initial location discovery can replace the path field. Wait for the initial
  // root to become selectable, then assert the exact new selection before submit.
  await expect(existing.getByRole("button", { name: "Select folder", exact: true })).toBeEnabled()
  await existing.getByRole("combobox").fill(projectB)
  await existing.getByRole("combobox").press("Enter")
  await expect(existing.locator(".directory-picker-selection")).toHaveText("C:\\OpenCode\\SidebarBeta")
  await expect(existing.getByRole("button", { name: "Select folder", exact: true })).toBeEnabled()
  await existing.getByRole("button", { name: "Select folder", exact: true }).click()
  await expect(sidebar.getByRole("button", { name: "SidebarBeta", exact: true })).toBeVisible()
  expect(creates).toHaveLength(1)
})

test("closing the active server's last tab opens the remaining server tab", async ({ page }) => {
  const sessionA = session({ id: "ses_server_a", directory: "C:/server-a", title: "Server A session" })
  const sessionB = session({ id: "ses_server_b", directory: "/home/server-b", title: "Server B session" })
  const requests: string[] = []
  page.on("request", (request) => {
    if (request.method() !== "OPTIONS") requests.push(request.url())
  })
  await twoServers(page, { a: [sessionA], b: [sessionB] })
  await page.goto(sessionHref(sessionA.id))
  await expectSessionTitle(page, sessionA.title)

  await page
    .locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(sessionA.id)}"])`)
    .getByRole("button", { name: "Close tab", exact: true })
    .click()

  await expectPath(page, sessionHref(sessionB.id, REMOTE_SERVER))
  await expectSessionTitle(page, sessionB.title)
  const reads = requests.filter((url) => url.includes(`/session/${sessionB.id}`))
  expect(reads.length).toBeGreaterThan(0)
  expect(reads.filter((url) => !url.startsWith(REMOTE_SERVER))).toEqual([])
})

test("a remote tab stays busy while a child session runs", async ({ page }) => {
  const sessionA = session({ id: "ses_server_a", directory: "C:/server-a", title: "Server A session" })
  const sessionB = session({ id: "ses_server_b", directory: "/home/server-b", title: "Server B session" })
  const child = session({ id: "ses_server_b_child", directory: sessionB.directory, parentID: sessionB.id })
  await twoServers(page, { a: [sessionA], b: [sessionB, child], running: child.id })
  await page.goto(sessionHref(sessionB.id, REMOTE_SERVER))
  await expectSessionTitle(page, sessionB.title)

  const tabB = page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(sessionB.id, REMOTE_SERVER)}"])`)
  const tabA = page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(sessionA.id)}"])`)
  await expect(tabB.locator('[data-component="session-progress-indicator-v2"]')).toBeVisible()
  await expect(tabA.locator("[data-titlebar-tab-title]")).toHaveText(sessionA.title)
  await expect(tabA.locator('[data-component="session-progress-indicator-v2"]')).toHaveCount(0)
})

test("inactive tabs stay busy while work waits in their inbox, and pulse on a new prompt, as in the TUI", async ({
  page,
}) => {
  const workspace = await openSession(page, {
    name: "TabInbox",
    sessions: [a, b, c],
    inbox: [
      {
        id: "inb_tab_b",
        sessionID: b.id,
        time: { created: 1 },
        type: "user",
        payload: { text: "Queued follow-up" },
        delivery: "queue",
      },
      // Parked synthetic context, such as a user shell's output, waits without work.
      {
        id: "inb_tab_c",
        sessionID: c.id,
        time: { created: 1 },
        type: "synthetic",
        payload: { text: "Shell output", description: "Shell finished" },
        delivery: "steer",
      },
    ],
  })

  const tab = (id: string) => page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(id)}"])`)
  const progress = '[data-component="session-progress-indicator-v2"]'

  await expect(tab(b.id).locator(progress)).toBeVisible()
  await expect(tab(c.id).locator("[data-titlebar-tab-title]")).toHaveText(c.title)
  await expect(tab(c.id).locator(progress)).toHaveCount(0)
  await expect(tab(c.id).locator('[data-slot="tab-prompt-pulse"]')).toHaveCount(0)
  // The pulse lasts one animation, so record that it appeared rather than racing its removal.
  await tab(c.id).evaluate((element) => {
    const observer = new MutationObserver(() => {
      if (!element.querySelector('[data-slot="tab-prompt-pulse"]')) return
      element.setAttribute("data-test-pulsed", "")
      observer.disconnect()
    })

    observer.observe(element, { childList: true, subtree: true })
  })

  await workspace.push([
    {
      id: "evt_tab_c_prompt",
      created: 2,
      type: "session.inbox.enqueued",
      durable: { aggregateID: c.id, seq: 1, version: 1 },
      data: {
        sessionID: c.id,
        inboxID: "inb_tab_c_prompt",
        item: { type: "user", payload: { text: "Another client's prompt" }, delivery: "queue" },
      },
    } satisfies Extract<OpenCodeEvent, { type: "session.inbox.enqueued" }>,
  ])

  await expect(tab(c.id)).toHaveAttribute("data-test-pulsed", "")
  await expect(tab(c.id).locator('[data-slot="tab-prompt-pulse"]')).toHaveCount(0)
  await expect(tab(c.id).locator(progress)).toBeVisible()
  await expect(tab(a.id).locator('[data-slot="tab-prompt-pulse"]')).toHaveCount(0)
})

test("selecting a tab with waiting work waits for its transcript instead of showing only the inbox", async ({
  page,
}) => {
  await openSession(page, {
    name: "TabInboxTranscript",
    sessions: [a, b],
    pageMessages: (id) => ({
      items:
        id === b.id ? [{ id: "msg_tab_b_history", type: "user", text: "Earlier prompt", time: { created: 1 } }] : [],
    }),
    inbox: [
      {
        id: "inb_tab_b_steer",
        sessionID: b.id,
        time: { created: 2 },
        type: "user",
        payload: { text: "Pending steer" },
        delivery: "steer",
      },
    ],
  })
  const tabB = page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(b.id)}"])`)
  // The inactive tab read its inbox, which materializes the pending steer as a transcript row.
  await expect(tabB.locator('[data-component="session-progress-indicator-v2"]')).toBeVisible()

  const transcript = await holdRoute(page, (url) => url.pathname === `/api/session/${b.id}/message`)
  await page.locator(`[data-titlebar-tab-link][href="${sessionHref(b.id)}"]`).click()
  await transcript.arrived
  await expect(page.locator("[data-timeline-virtual-content]")).toHaveCount(0)

  transcript.release()
  await expect(page.locator('[data-timeline-row="UserMessage"][data-message-id="msg_tab_b_history"]')).toContainText(
    "Earlier prompt",
  )
  await expect(page.locator('[data-timeline-row="UserMessage"][data-message-id="inb_tab_b_steer"]')).toContainText(
    "Pending steer",
  )
})

test("inactive tabs load attention and inbox, but read the transcript only on selection", async ({ page }) => {
  const reads: string[] = []
  const mutations: string[] = []
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.startsWith("/api/") && !response.ok())
      errors.push(`HTTP ${response.status()}: ${response.url()}`)
  })
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname

    if (!path.startsWith("/api/")) return

    if (request.method() === "GET") reads.push(path)

    if (request.method() === "DELETE" || /\/(interrupt|prompt)$/.test(path)) mutations.push(path)
  })
  const state = { text: "Original fixture answer" }
  await mockStressTimeline(page, {
    pageMessages: (id) => ({
      items: [
        { id: `msg_${id}_user`, type: "user", text: "Review the renderer change", time: { created: 1 } },
        {
          id: `msg_${id}_assistant`,
          type: "assistant",
          agent: "build",
          model: { id: "claude-opus-4-6", providerID: "opencode" },
          content: [{ type: "text", text: state.text }],
          time: { created: 2, completed: 3 },
        },
      ],
    }),
  })
  await seed(page, {
    projects: { local: [{ worktree: fixture.directory, expanded: true }] },
    lastProject: { local: fixture.directory },
    tabs: [fixture.sourceID, fixture.targetID, fixture.childID],
  })

  const attention = Promise.all(
    [fixture.targetID, fixture.childID].flatMap((id) =>
      ["permission", "form", "inbox"].map((kind) =>
        page.waitForResponse((response) => new URL(response.url()).pathname === `/api/session/${id}/${kind}`),
      ),
    ),
  )

  await page.goto(sessionHref(fixture.sourceID))
  await expectSessionTitle(page, fixture.expected.sourceTitle)
  await expect(page.locator(`[data-timeline-part-id="msg_${fixture.sourceID}_assistant:text:0"]`)).toContainText(
    state.text,
  )
  await attention

  const child = page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(fixture.childID)}"])`)
  await child.getByRole("button", { name: "Close tab", exact: true }).click()
  await expect(child).toHaveCount(0)
  await expectPath(page, sessionHref(fixture.sourceID))

  state.text = "Latest fixture answer after tab restoration"
  await page.locator(`[data-slot="titlebar-tabs"] a[href="${sessionHref(fixture.targetID)}"]`).click()
  await expectSessionTitle(page, fixture.expected.targetTitle)
  await expect(page.locator(`[data-timeline-part-id="msg_${fixture.targetID}_assistant:text:0"]`)).toContainText(
    state.text,
  )

  // Every tab reads its inbox once, since waiting work keeps a tab busy; selection reuses that read.
  for (const id of [fixture.sourceID, fixture.targetID, fixture.childID])
    expect(reads.filter((path) => path === `/api/session/${id}/inbox`)).toHaveLength(1)

  for (const id of [fixture.sourceID, fixture.targetID])
    expect(reads.filter((path) => path === `/api/session/${id}/message`)).toHaveLength(1)

  expect(reads.filter((path) => path === `/api/session/${fixture.childID}/message`)).toEqual([])
  expect(mutations).toEqual([])
  expect(errors).toEqual([])
})

test("five loaded workspace tabs stay rendered and reactive through repeated switches", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })

  const sessions = Array.from({ length: 5 }, (_, index) => ({
    ...fixture.sessions[0]!,
    id: `ses_workspace_cycle_${index}`,
    directory: `${fixture.directory}/worktree-${index}`,
    title: `Workspace session ${index}`,
  }))

  const mock = await mockStressTimeline(page, {
    sessions,
    pageMessages: (id) => ({
      items: [
        { id: `msg_user_${id}`, type: "user", text: `Prompt for ${id}`, time: { created: 1 } },
        {
          id: `msg_assistant_${id}`,
          type: "assistant",
          agent: "build",
          model: { id: "claude-opus-4-6", providerID: "opencode" },
          time: { created: 2, completed: 3 },
          content: [{ type: "text", text: `Answer for ${id}` }],
        },
      ] satisfies SessionMessageInfo[],
    }),
  })

  // Each worktree session resolves to its own location in the shared project (the mock echoes the requested one).
  await seed(page, {
    projects: { local: [{ worktree: fixture.directory, expanded: true }] },
    tabs: sessions.map((item) => item.id),
  })
  await page.goto(sessionHref(sessions[0]!.id))
  await expect(page.getByText(`Answer for ${sessions[0]!.id}`, { exact: true })).toBeVisible()

  for (const item of [...sessions.slice(1), ...sessions, ...sessions.toReversed()]) {
    await page.locator(`[data-titlebar-tab-link][href="${sessionHref(item.id)}"]`).click()
    await expect(page.locator(`[data-timeline-part-id="msg_assistant_${item.id}:text:0"]`)).toBeVisible()
    await expect(page.locator("[data-timeline-virtual-content]")).toHaveCSS("visibility", "visible")
  }

  const active = sessions[0]!
  await mock.push([
    {
      id: "evt_workspace_cycle_update",
      created: 4,
      type: "session.text.ended",
      location: { directory: active.directory },
      durable: { aggregateID: active.id, seq: 0, version: 1 },
      data: {
        sessionID: active.id,
        assistantMessageID: `msg_assistant_${active.id}`,
        ordinal: 0,
        text: "Still receiving updates",
      },
    },
  ])
  await expect(page.getByText("Still receiving updates", { exact: true })).toBeVisible()
})

test("each session tab shows its own file tab after a switch to a session in another folder", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const directory = "C:/OpenCode/FolderSwitch"
  const alpha = { id: "ses_folderswitch_alpha", title: "Folder switch alpha" }
  const beta = { id: "ses_folderswitch_beta", title: "Folder switch beta" }
  const other = { id: "ses_folderswitch_other", title: "Folder switch other", directory: "C:/OpenCode/FolderOther" }
  await openSession(page, {
    name: "FolderSwitch",
    sessions: [alpha, beta, other],
    fileList: (path) => (path ? [] : ["greet.ts", "guide.md", "notes.txt"].map((file) => fileNode(directory, file))),
    fileContent: (path) => ({ type: "text", content: `contents:${path}` }),
    seed: { panes: Object.fromEntries([alpha, beta, other].map((item) => [item.id, { review: true }])) },
  })
  const panel = page.locator("#review-panel")

  const shows = async (file: string) => {
    await expect(panel.getByRole("tab", { name: file, exact: true })).toHaveAttribute("aria-selected", "true")
    await expect(panel.getByText(`contents:${file}`, { exact: true })).toBeVisible()
  }

  const visit = async (target: { id: string; title: string }) => {
    await page.locator(`[data-titlebar-tab-link][href="${sessionHref(target.id)}"]`).click()
    await expectSessionTitle(page, target.title)
  }

  const open = async (file: string) => {
    await panel.getByRole("button", { name: "Open file" }).click()
    await panel.getByRole("button", { name: file, exact: true }).click()
    await shows(file)
  }

  await open("greet.ts")
  await visit(other)
  await open("notes.txt")
  await visit(beta)
  await open("guide.md")

  // The session screen stays mounted while the route moves between folders, and each tab reads its own folder.
  for (const [target, file] of [
    [alpha, "greet.ts"],
    [other, "notes.txt"],
    [beta, "guide.md"],
    [other, "notes.txt"],
    [alpha, "greet.ts"],
  ] as const) {
    await visit(target)
    await shows(file)
  }
})

// Windows has no native menu bar: the titlebar menu owns Paste, which only the desktop edit action can perform.
test("the Windows titlebar menu pastes through the desktop edit action", async ({ page }) => {
  await mockWorkspace(page, { name: "WindowsMenu", sessions: [] })
  await page.goto(`/e2e/utils/windows-menu.html?${new URLSearchParams({ server: SERVER })}`)
  await page.getByRole("button", { name: "OpenCode menu", exact: true }).click()
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click()
  const paste = page.getByRole("menuitem", { name: /^Paste/ })
  await expect(paste).toHaveText("PasteCtrl+V")
  await paste.click()
  await expect(page.getByRole("status", { name: "Desktop menu actions" })).toHaveText("edit.paste")
})

// Server A is the default origin; B is a remote that answers only for its own directories.
async function twoServers(
  page: Page,
  input: {
    a: ReturnType<typeof session>[]
    b: ReturnType<typeof session>[]
    running?: string
  },
) {
  const config = (sessions: ReturnType<typeof session>[], id: string) => {
    const directory = String(sessions[0]!.directory)

    return {
      directory,
      project: project({ id, directory }),
      provider: NO_PROVIDER,
      sessions,
      pageMessages: () => ({ items: [] }),
      strictDirectory: true,
    }
  }

  await mockServers(page, {
    [SERVER]: config(input.a, "proj_server_a"),
    [REMOTE_SERVER]: {
      ...config(input.b, "proj_server_b"),
      sessionStatus: input.running ? { [input.running]: { type: "running" } } : {},
    },
  })
  await seed(page, {
    servers: [REMOTE_SERVER],
    tabs: [input.a[0]!.id, { session: input.b[0]!.id, server: REMOTE_SERVER }],
  })
}
