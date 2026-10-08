import { randomUUID } from "node:crypto"
import type { Event } from "electron"
import { PersistenceBarrier } from "../../shared/ipc-rpc/events"
import { emitIpcEvent } from "../ipc-events"
import { getMainWindows } from "../windows"

const pending = new Map<number, { id: string; resolve: () => void; reject: (error: Error) => void }>()

export function acknowledgePersistenceBarrier(window: number, id: string, success: boolean) {
  const request = pending.get(window)

  if (request?.id !== id) return

  if (success) request.resolve()
  else request.reject(new Error("Renderer could not save its pending changes"))
}

/** Freeze every main renderer and await its draft/blob and namespace writes before teardown. */
export async function prepareRendererPersistence() {
  if (pending.size) throw new Error("A renderer persistence barrier is already active")

  const id = randomUUID()
  const windows = getMainWindows()
  const ids = windows.map((win) => win.webContents.id)
  let invalid = false
  const cleanups: (() => void)[] = []

  const verify = () => {
    if (invalid || getMainWindows().some((win) => !windows.includes(win)))
      throw new Error("Renderer inventory changed during persistence barrier")
  }

  const release = () => {
    for (const cleanup of cleanups) cleanup()

    for (const key of ids) pending.delete(key)

    for (const win of windows) {
      if (!win.isDestroyed() && !win.webContents.isDestroyed())
        emitIpcEvent(win.webContents, new PersistenceBarrier({ id, phase: "cancel" }))
    }
  }

  try {
    await Promise.all(
      windows.map((win) => new Promise<void>((resolve, reject) => {
        const contents = win.webContents

        const changed = () => {
          invalid = true
          reject(new Error("Renderer changed during persistence barrier"))
        }

        const timeout = setTimeout(() => reject(new Error("Renderer persistence acknowledgement timed out")), 30_000)
        // Body inert blocks pointer edits; capture native keyboard input too, including document shortcuts.
        const blockInput = (event: Event) => event.preventDefault()
        pending.set(contents.id, { id, resolve, reject })
        contents.on("before-input-event", blockInput)
        contents.once("destroyed", changed)
        contents.once("did-start-loading", changed)
        cleanups.push(() => {
          clearTimeout(timeout)
          contents.off("destroyed", changed)
          contents.off("did-start-loading", changed)
          contents.off("before-input-event", blockInput)
        })
        emitIpcEvent(contents, new PersistenceBarrier({ id, phase: "prepare" }))
      })),
    )
    verify()

    return { release, verify }
  } catch (error) {
    release()

    throw error
  }
}
