import { createServer } from "node:http"
import { authenticate, LinkError } from "./policy.mjs"
import { deliver, parseMessage } from "./delivery.mjs"
import { monitor } from "./monitor.mjs"

export async function startGateway({ api, policy, observer, port = 0 }) {
  const server = createServer(async (request, response) => {
    const send = (status, body) => {
      response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" })
      response.end(JSON.stringify(body))
    }
    try {
      if (request.url === "/health" && request.method === "GET") return send(200, { service: "session-link", version: 1 })
      if (request.url === "/monitor" && request.method === "GET" && observer) {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" })
        return response.end(monitor)
      }
      if (["/activity", "/events"].includes(request.url) && request.method === "GET" && observer) {
        authenticate(await policy(), request.headers["x-session-link-sender"], request.headers.authorization)
        if (request.url === "/activity") return send(200, await observer.refreshInventory())
        response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" })
        const emit = (value) => response.write(`data: ${JSON.stringify(value)}\n\n`)
        emit(observer.snapshot())
        const unsubscribe = observer.subscribe(emit)
        response.on("close", unsubscribe)
        return
      }
      if (request.url !== "/messages" || request.method !== "POST") return send(404, { error: "not_found" })
      // A credential is bound to its configured sender; a body cannot claim origin.
      const current = await policy()
      const sender = authenticate(current, request.headers["x-session-link-sender"], request.headers.authorization)
      const chunks = []
      let size = 0
      for await (const chunk of request) {
        size += chunk.length
        if (size > 65536) throw new LinkError(413, "too_large", "Message exceeds 64 KiB")
        chunks.push(chunk)
      }
      const text = Buffer.concat(chunks).toString("utf8")
      const body = (() => {
        try { return JSON.parse(text) }
        catch { throw new LinkError(400, "invalid_json", "Expected JSON") }
      })()
      const receipt = await deliver(api, current, sender, parseMessage(body))
      return send(202, receipt)
    } catch (error) {
      if (error instanceof LinkError) return send(error.status, { error: error.code, message: error.message })
      // Never return arbitrary upstream errors, config contents, or credentials.
      return send(500, { error: "internal_error", message: "Message admission failed; retry with the same messageID" })
    }
  })
  server.requestTimeout = 30000
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, "127.0.0.1", resolve)
  })
  let closing
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => closing ??= new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
      server.closeAllConnections()
    }),
  }
}
