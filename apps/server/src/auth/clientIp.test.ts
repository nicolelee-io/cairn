import { describe, expect, it } from 'vitest'
import { clientIp, parseTrustProxy } from './clientIp.ts'

const req = (peer: string | undefined, xff?: string) => ({
  env: peer === undefined ? undefined : { incoming: { socket: { remoteAddress: peer } } },
  req: { header: (n: string) => (n === 'x-forwarded-for' ? xff : undefined) },
})

describe('parseTrustProxy', () => {
  it('trusts nobody when unset, empty or false', () => {
    expect(parseTrustProxy(undefined)).toBeUndefined()
    expect(parseTrustProxy(' ')).toBeUndefined()
    expect(parseTrustProxy('false')).toBeUndefined()
  })

  it('matches IPs and CIDRs, including IPv4-mapped peers', async () => {
    const trust = parseTrustProxy('172.20.0.3, 10.0.0.0/8, fd00::/8')!
    expect(await trust('172.20.0.3')).toBe(true)
    expect(await trust('::ffff:172.20.0.3')).toBe(true)
    expect(await trust('172.20.0.1')).toBe(false)
    expect(await trust('10.200.1.1')).toBe(true)
    expect(await trust('fd12::1')).toBe(true)
    expect(await trust(undefined)).toBe(false)
  })

  it('resolves hostnames', async () => {
    const trust = parseTrustProxy('localhost')!
    expect(await trust('127.0.0.1')).toBe(true)
    expect(await trust('172.20.0.3')).toBe(false)
  })

  it('refuses entries it cannot read', () => {
    expect(() => parseTrustProxy('10.0.0.0/33')).toThrow(/TRUST_PROXY/)
    expect(() => parseTrustProxy('10.0.0.1/8/2')).toThrow(/TRUST_PROXY/)
    expect(() => parseTrustProxy('http://proxy')).toThrow(/TRUST_PROXY/)
  })
})

describe('clientIp', () => {
  const trust = parseTrustProxy('172.20.0.3')

  it('uses the socket peer when no proxy is trusted, whatever the headers say', async () => {
    expect(await clientIp(req('::ffff:172.20.0.1', '1.2.3.4'), undefined)).toBe('172.20.0.1')
    expect(await clientIp(req('172.20.0.1', '1.2.3.4'), trust)).toBe('172.20.0.1')
    expect(await clientIp(req(undefined, '1.2.3.4'), undefined)).toBe('unknown')
  })

  it("takes a trusted proxy's rightmost X-Forwarded-For entry", async () => {
    expect(await clientIp(req('172.20.0.3', '6.6.6.6, 203.0.113.9'), trust)).toBe('203.0.113.9')
    expect(await clientIp(req('172.20.0.3', '203.0.113.9'), trust)).toBe('203.0.113.9')
  })

  it('falls back to the peer when a trusted proxy sends nothing usable', async () => {
    expect(await clientIp(req('172.20.0.3'), trust)).toBe('172.20.0.3')
    expect(await clientIp(req('172.20.0.3', 'garbage'), trust)).toBe('172.20.0.3')
  })
})
