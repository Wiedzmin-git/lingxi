import { LinkError } from "./policy.mjs"

export function makeApi(url, password, directory) {
  const address = new URL(url)
  if (address.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(address.hostname) || address.username || address.password)
    throw new Error("The first prototype connects only to a loopback OpenCode server")
  const headers = {
    authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
    "content-type": "application/json",
    ...(directory ? { "x-opencode-directory": encodeURIComponent(directory) } : {}),
  }
  async function requestEnvelope(method, path, body, signal) {
    const response = await fetch(new URL(path, address), {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new LinkError([400, 404, 409].includes(response.status) ? response.status : 502, "opencode_error", `OpenCode returned HTTP ${response.status}`)
    }
    if (response.status === 204) return
    return await response.json()
  }
  const request = async (...args) => (await requestEnvelope(...args))?.data
  async function* stream(path, signal) {
    const response = await fetch(new URL(path, address), { headers, signal })
    if (!response.ok) throw new Error(`Event stream returned HTTP ${response.status}`)
    const decoder = new TextDecoder()
    let buffer = ""
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true })
      let match
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, match.index)
        buffer = buffer.slice(match.index + match[0].length)
        const data = frame.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n")
        if (data) yield JSON.parse(data)
      }
    }
  }
  async function* events(signal) {
    yield* stream("/api/event", signal)
    if (!signal.aborted) throw new Error("Event stream disconnected")
  }
  return {
    request,
    requestEnvelope,
    events,
    log: (sessionID, after, signal) => stream(`/api/experimental/session/${encodeURIComponent(sessionID)}/log?after=${after}&follow=false`, signal),
    get: ({ sessionID, signal }) => request("GET", `/api/session/${encodeURIComponent(sessionID)}`, undefined, signal),
    synthetic: ({ sessionID, ...input }) => request("POST", `/api/session/${encodeURIComponent(sessionID)}/synthetic`, input),
  }
}
