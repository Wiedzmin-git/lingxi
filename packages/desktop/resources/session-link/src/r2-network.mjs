import { lookup } from "node:dns/promises"
import { createSocket } from "node:dgram"
import { hostname, networkInterfaces } from "node:os"
import { isIP } from "node:net"
import { parsePublishedHost } from "./r2-http.mjs"
import { LinkError } from "./policy.mjs"

async function addresses(name) {
  parsePublishedHost(name)
  if (isIP(name) === 4) return [name]
  const values = await lookup(name, { all: true, family: 4 }).catch(() => {
    throw new LinkError(400, "dns_lookup_failed", "Computer name cannot be resolved to IPv4")
  })
  if (!values.length) throw new LinkError(400, "dns_lookup_failed", "Computer name has no IPv4 address")
  return [...new Set(values.map((value) => value.address))]
}

export async function verifyPublishedHost(config) {
  if (!config.enabled || config.publishHost === undefined) return
  if (!(await addresses(config.publishHost)).includes(config.host))
    throw new LinkError(400, "published_host_mismatch", "Published computer name does not resolve to the selected local bind address")
}

/** Uses the OS route without sending a datagram. No guessed IP, firewall change or new service. */
export async function discoverLan(config, input) {
  const interfaces = Object.entries(networkInterfaces()).flatMap(([name, values]) => (values ?? [])
    .filter((value) => value.family === "IPv4").map((value) => ({ name, ...value })))
  const peerAddresses = input.peer ? await addresses(input.peer) : []
  if (peerAddresses.some((address) => !config.networks.check(address, "ipv4")))
    throw new LinkError(403, "network_denied", "Peer resolves outside the configured outgoing networks")
  const routes = input.bind ? [input.bind] : peerAddresses.length ? await Promise.all(peerAddresses.map(async (address) => {
    const socket = createSocket("udp4")
    try {
      await new Promise((resolve, reject) => {
        socket.once("error", reject)
        socket.connect(config.port, address, resolve)
      })
      return socket.address().address
    } catch {
      throw new LinkError(400, "network_route_failed", "Cannot determine the local route to the peer")
    } finally { socket.close() }
  })) : interfaces.filter((value) => !value.internal && config.networks.check(value.address, "ipv4")).map((value) => value.address)
  const unique = [...new Set(routes)]
  if (unique.length !== 1) throw new LinkError(400, unique.length ? "ambiguous_interface" : "interface_unavailable", "Choose a peer computer name or an explicit local IPv4 when the route is not unique")
  const selected = interfaces.find((value) => value.address === unique[0])
  if (!selected || unique[0] === "0.0.0.0") throw new LinkError(400, "interface_unavailable", "Selected IPv4 is not a local interface")
  return { computer: hostname(), host: selected.address, interface: selected.name,
    publishHost: input.publishHost ?? hostname(), peerAddresses }
}
