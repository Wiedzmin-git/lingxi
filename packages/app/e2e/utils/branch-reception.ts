import type { Page } from "@playwright/test"
import type { SessionLinkResult } from "../../src/runtime/platform/session-link"

// Only the native owner-status observation is substituted; render the real tabs.
export async function mockBranchReception(page: Page, initial: Record<string, SessionLinkResult>) {
  const statuses = { ...initial }
  const requests: { server: string; sessionID: string }[] = []
  await page.route("**/e2e/branch-reception?*", async (route) => {
    const query = new URL(route.request().url()).searchParams
    const input = { server: query.get("server") ?? "", sessionID: query.get("sessionID") ?? "" }
    requests.push(input)
    await route.fulfill({ json: statuses[input.sessionID] ?? { error: "different_server" } })
  })

  return {
    requests,
    update: async (sessionID: string, value: SessionLinkResult) => {
      const observed = page.waitForResponse((response) => {
        const url = new URL(response.url())

        return url.pathname === "/e2e/branch-reception" && url.searchParams.get("sessionID") === sessionID
      })

      statuses[sessionID] = value
      await observed
    },
  }
}
