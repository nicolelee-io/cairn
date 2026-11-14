import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'

/** Whether the connecting peer is a reverse proxy whose X-Forwarded-For can be believed. */
export type TrustProxy = (peer: string | undefined) => boolean | Promise<boolean>

const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i
const HOST_TTL_MS = 60_000

/**
 * Parses TRUST_PROXY: unset or empty trusts nobody; `true` trusts every peer (only when nothing but
 * the proxy can reach the port); otherwise a comma-separated list of IPs, CIDRs and hostnames (a
 * Docker container name such as `cloudflared`, looked up again each minute since its IP changes
 * when the container is recreated). Throws on an entry it can't read, so a typo stops the start.
 */
export function parseTrustProxy(value: string | undefined): TrustProxy | undefined {
  const raw = value?.trim()
  if (!raw || raw === 'false') return undefined
  if (raw === 'true') return () => true

  const fixed = new BlockList()
  const hosts: string[] = []
  for (const entry of raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const [addr = '', prefix, extra] = entry.split('/')
    const family = isIP(addr)
    if (family && prefix === undefined) {
      fixed.addAddress(addr, family === 4 ? 'ipv4' : 'ipv6')
    } else if (family && extra === undefined && /^\d+$/.test(prefix ?? '')) {
      const bits = Number(prefix)
      if (bits > (family === 4 ? 32 : 128)) throw new Error(`TRUST_PROXY: bad prefix in "${entry}"`)
      fixed.addSubnet(addr, bits, family === 4 ? 'ipv4' : 'ipv6')
    } else if (!entry.includes('/') && HOSTNAME.test(entry)) {
      hosts.push(entry)
    } else {
      throw new Error(`TRUST_PROXY: "${entry}" is not an IP, CIDR or hostname`)
    }
  }

  let resolved: { at: number; ips: Set<string> } | undefined
  const hostIps = async (): Promise<Set<string>> => {
    if (resolved && Date.now() - resolved.at < HOST_TTL_MS) return resolved.ips
    const ips = new Set<string>()
    for (const host of hosts) {
      // A proxy that's down or renamed just isn't trusted; logins still work, keyed on its address.
      const found = await lookup(host, { all: true }).catch(() => [])
      for (const { address } of found) ips.add(unmap(address))
    }
    resolved = { at: Date.now(), ips }
    return ips
  }

  return async (peer) => {
    if (!peer) return false
    const ip = unmap(peer)
    const family = isIP(ip)
    if (!family) return false
    if (fixed.check(ip, family === 4 ? 'ipv4' : 'ipv6')) return true
    return hosts.length > 0 && (await hostIps()).has(ip)
  }
}

/**
 * The address to rate-limit a request by. A trusted proxy's X-Forwarded-For is used, its rightmost
 * entry (the one the proxy itself added; anything left of it came from the client and can be made
 * up; cloudflared appends the real visitor too). Otherwise, or with no such header, the socket's
 * own peer address.
 */
export async function clientIp(
  c: { env: unknown; req: { header(n: string): string | undefined } },
  trust: TrustProxy | undefined,
): Promise<string> {
  const peer = socketAddress(c.env)
  if (trust && (await trust(peer))) {
    const last = c.req
      .header('x-forwarded-for')
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .at(-1)
    if (last && isIP(unmap(last))) return unmap(last)
  }
  return peer ? unmap(peer) : 'unknown'
}

/** The node-server binding's socket peer; absent under `app.request` in tests. */
function socketAddress(env: unknown): string | undefined {
  const bindings = env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined
  return bindings?.incoming?.socket?.remoteAddress
}

/** `::ffff:172.20.0.3` (an IPv4 peer on a dual-stack socket) is just 172.20.0.3. */
function unmap(ip: string) {
  return ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip
}
