import { expect, type Locator, type Page } from "@playwright/test"
import { sessionHref } from "./app"

export const APP_READY_TIMEOUT = 30_000

export async function expectAppVisible(locator: Locator) {
  await expect(locator).toBeVisible({ timeout: APP_READY_TIMEOUT })
}

export async function expectSessionTitle(page: Page, title: string) {
  if ((page.viewportSize()?.width ?? 1280) < 768) {
    const trigger = page.locator('[data-slot="mobile-tabs-trigger"]')
    await expectAppVisible(trigger)
    await expect(trigger.locator('span[dir="auto"]')).toHaveText(title, { timeout: APP_READY_TIMEOUT })

    return
  }

  await expectAppVisible(page.getByRole("heading", { name: title }))
}

export async function expectSessionReady(page: Page, input: { server: string; sessionID: string; title: string }) {
  await expect(page).toHaveURL(sessionHref(input.sessionID, input.server))
  await expectSessionTitle(page, input.title)
}

// Browser drafts save asynchronously; reload only after the changed document reached IndexedDB.
export async function expectStoredPrompt(page: Page, text: string) {
  await expect.poll(() => page.evaluate((text) => new Promise<boolean>((resolve, reject) => {
    const open = indexedDB.open("opencode-drafts", 1)
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const database = open.result
      const documents = database.transaction("documents").objectStore("documents").getAll()
      documents.onerror = () => {
        database.close()
        reject(documents.error)
      }

      documents.onsuccess = () => {
        database.close()
        resolve(documents.result.some((value: string) => value.includes(`"content":${JSON.stringify(text)}`)))
      }
    }
  }), text),
  ).toBe(true)
}
