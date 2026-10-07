import { setTimeout as delay } from "node:timers/promises"
import { inspect } from "./controls.mjs"
import { applyEvent, blankBranch, fromInspection } from "./observer-state.mjs"

export function startObserver(api) {
  const abort = new AbortController()
  const branches = new Map()
  const listeners = new Set()
  const pendingReads = new Map()
  let connected = false
  let gapObserved = false
  let snapshotError = false
  let lastServerReplyAt
  let serverResponding
  let epoch = 0
  let recovering = true
  let inventoryRead
  const snapshot = () => ({ connected, serverResponding, gapObserved, snapshotError, recovering, lastServerReplyAt, observedAt: Date.now(), branches: [...branches.values()].map((state) => ({ ...state, queued: state.inboxIDs.length })) })
  const publish = () => { for (const listener of listeners) listener(snapshot()) }
  const track = async (sessionID) => {
    if (pendingReads.has(sessionID)) return pendingReads.get(sessionID).promise
    const refresh = { events: [], promise: undefined }
    pendingReads.set(sessionID, refresh)
    const pending = (async () => {
      while (!abort.signal.aborted) {
        const readingEpoch = epoch
        refresh.events = []
        let value
        try { value = await inspect(api, sessionID, abort.signal) }
        catch (error) { if (readingEpoch !== epoch && !abort.signal.aborted) continue; throw error }
        // A live-only stream cannot fill an outage. An inspection that straddles
        // one is discarded and reissued, not stamped as newly current.
        if (readingEpoch !== epoch) continue
        let state = fromInspection(value, branches.get(sessionID))
        for (const event of refresh.events) {
          if (!state) break
          state = applyEvent(state, event)
        }
        if (state) branches.set(sessionID, state)
        else branches.delete(sessionID)
        publish()
        return
      }
    })().catch((error) => {
      if (error.status === 404) branches.delete(sessionID)
      else if (!abort.signal.aborted) snapshotError = true
      publish()
      if (!abort.signal.aborted && error.status !== 404) throw error
    }).finally(() => pendingReads.delete(sessionID))
    refresh.promise = pending
    return pending
  }
  const consume = (event) => {
    const sessionID = event.data?.sessionID
    if (!sessionID) return
    pendingReads.get(sessionID)?.events.push(event)
    if (!branches.has(sessionID) && event.type !== "session.deleted") branches.set(sessionID, blankBranch(sessionID, event.data.title))
    const previous = branches.get(sessionID)
    if (!previous) return
    const state = applyEvent(previous, event)
    if (state) branches.set(sessionID, state)
    else branches.delete(sessionID)
    publish()
  }
  const running = (async () => {
    while (!abort.signal.aborted) {
      try {
        for await (const event of api.events(abort.signal)) {
          if (event.type === "server.connected") {
            epoch++
            recovering = true
            connected = true
            serverResponding = true
            lastServerReplyAt = Date.now()
            publish()
            // Live-only events cannot replay an outage. Recover current state,
            // retaining the visible gap flag rather than inventing missing work.
            void refreshInventory().catch(() => { snapshotError = true; publish() })
          }
          consume(event)
        }
      } catch {
        if (abort.signal.aborted) break
        connected = false
        epoch++
        recovering = true
        gapObserved = true
        publish()
        await delay(1000, undefined, { signal: abort.signal }).catch(() => {})
      }
    }
  })()
  const heartbeat = setInterval(async () => {
    try {
      await api.requestEnvelope("GET", "/api/info", undefined, abort.signal)
      lastServerReplyAt = Date.now()
      serverResponding = true
      publish()
    } catch {
      if (!abort.signal.aborted) { serverResponding = false; publish() }
    }
  }, 10000)
  heartbeat.unref()
  function refreshInventory() {
    return inventoryRead ??= (async () => {
      while (!abort.signal.aborted) {
        const readingEpoch = epoch
        const ids = new Set([...branches.keys(), ...pendingReads.keys()])
        let cursor
        do {
          const query = new URLSearchParams({ limit: "100", ...(cursor ? { cursor } : {}) })
          const page = await api.requestEnvelope("GET", `/api/session?${query}`, undefined, abort.signal)
          for (const session of page.data) ids.add(session.id)
          cursor = page.cursor?.next
        } while (cursor && readingEpoch === epoch)
        if (readingEpoch !== epoch) continue
        await Promise.all([...ids].map(track))
        if (readingEpoch !== epoch) continue
        snapshotError = false
        recovering = !connected
        publish()
        return snapshot()
      }
      return snapshot()
    })().finally(() => { inventoryRead = undefined })
  }
  return {
    track, snapshot,
    subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback) },
    refreshInventory,
    async close() { clearInterval(heartbeat); abort.abort(); await running; await Promise.allSettled([inventoryRead, ...[...pendingReads.values()].map((read) => read.promise)]); listeners.clear() },
  }
}
