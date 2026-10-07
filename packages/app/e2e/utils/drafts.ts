import type { Page } from "@playwright/test"

/** Observe the committed draft before reloading; the app batches asynchronous IndexedDB writes. */
export function storedSessionDraft(page: Page, sessionID: string) {
  return page.evaluate(async (sessionID) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("opencode-drafts", 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })

    const transaction = db.transaction("documents")
    const keys = transaction.objectStore("documents").getAllKeys()
    const values = transaction.objectStore("documents").getAll()

    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    db.close()
    const index = keys.result.findIndex((key) => String(key).endsWith(`session:${sessionID}:prompt`))

    return index < 0 ? "" : String(values.result[index])
  }, sessionID)
}
