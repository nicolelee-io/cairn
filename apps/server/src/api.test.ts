import { beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app.ts'
import { addUser, memoryDb } from './test-helpers.ts'

const HOST = 'cairn.test'
const base = { host: HOST }

let app: ReturnType<typeof createApp>
let clock = Date.UTC(2026, 9, 29)

beforeAll(async () => {
  const { db } = memoryDb()
  await addUser(db, 'Alice', 'correct horse')
  app = createApp({ sha: 'abc', db, now: () => clock, trustProxy: () => true })
})

const login = (body: unknown, headers: Record<string, string> = {}) =>
  app.request('/api/auth/login', {
    method: 'POST',
    headers: { ...base, 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })

const cookieOf = (res: Response) => res.headers.get('set-cookie')?.split(';')[0] ?? ''

describe('auth', () => {
  it('serves /api/health without a session', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok', sha: 'abc', builtAt: null })
  })

  it('401s unauthenticated API requests, including unknown routes', async () => {
    expect((await app.request('/api/auth/me')).status).toBe(401)
    expect((await app.request('/api/entries')).status).toBe(401)
    expect((await app.request('/api/nope')).status).toBe(401)
  })

  it('logs in case-insensitively, sets a hardened cookie, and the session works', async () => {
    const res = await login({ username: 'ALICE', password: 'correct horse' })
    expect(res.status).toBe(200)
    const setCookie = res.headers.get('set-cookie')!
    expect(setCookie).toMatch(/HttpOnly/i)
    expect(setCookie).toMatch(/SameSite=Lax/i)
    expect(setCookie).not.toMatch(/Secure/i) // plain http request

    const me = await app.request('/api/auth/me', { headers: { cookie: cookieOf(res) } })
    expect(me.status).toBe(200)
    expect(await me.json()).toMatchObject({ username: 'alice', defaultTimezone: 'America/Denver' })

    const unknown = await app.request('/api/nope', { headers: { cookie: cookieOf(res) } })
    expect(unknown.status).toBe(404)
  })

  it('marks the cookie Secure when the request came in over https', async () => {
    const res = await login(
      { username: 'alice', password: 'correct horse' },
      { 'x-forwarded-proto': 'https' },
    )
    expect(res.headers.get('set-cookie')).toMatch(/Secure/i)
  })

  it('rejects a wrong password and an unknown user identically', async () => {
    const wrong = await login(
      { username: 'alice', password: 'nope' },
      { 'x-forwarded-for': '1.1.1.1' },
    )
    const unknown = await login(
      { username: 'ghost', password: 'nope' },
      { 'x-forwarded-for': '1.1.1.2' },
    )
    expect(wrong.status).toBe(401)
    expect(unknown.status).toBe(401)
    expect(await wrong.json()).toEqual(await unknown.json())
  })

  it('rejects malformed login bodies', async () => {
    expect((await login({ username: 'alice' })).status).toBe(400)
  })

  it('clears a stale session cookie when it is rejected', async () => {
    const res = await app.request('/api/auth/me', { headers: { cookie: 'cairn_session=bogus' } })
    expect(res.status).toBe(401)
    const cleared = res.headers.get('set-cookie')!
    expect(cleared).toMatch(/cairn_session=;/)
    expect(cleared).toMatch(/Max-Age=0/i)
  })

  it('logout invalidates the session', async () => {
    const cookie = cookieOf(await login({ username: 'alice', password: 'correct horse' }))
    const out = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { ...base, cookie },
    })
    expect(out.status).toBe(204)
    expect((await app.request('/api/auth/me', { headers: { cookie } })).status).toBe(401)
  })

  it('expires sessions after the TTL', async () => {
    const cookie = cookieOf(await login({ username: 'alice', password: 'correct horse' }))
    clock += 31 * 24 * 60 * 60 * 1000
    expect((await app.request('/api/auth/me', { headers: { cookie } })).status).toBe(401)
  })

  it('rate limits repeated failures from one IP, then recovers after the window', async () => {
    const ip = { 'x-forwarded-for': '9.9.9.9' }
    for (let i = 0; i < 8; i++) {
      expect((await login({ username: 'alice', password: 'bad' }, ip)).status).toBe(401)
    }
    const limited = await login({ username: 'alice', password: 'correct horse' }, ip)
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)

    clock += 16 * 60 * 1000
    expect((await login({ username: 'alice', password: 'correct horse' }, ip)).status).toBe(200)
  })

  it('a username lockout spares browsers that signed in as that user before', async () => {
    const { db } = memoryDb()
    await addUser(db, 'owner', 'owner password')
    const own = createApp({ sha: 'x', db, now: () => clock, trustProxy: () => true })
    const post = (password: string, ip: string, cookie = '') =>
      own.request('/api/auth/login', {
        method: 'POST',
        headers: { ...base, 'content-type': 'application/json', 'x-forwarded-for': ip, cookie },
        body: JSON.stringify({ username: 'owner', password }),
      })

    const first = await post('owner password', '10.9.0.1')
    expect(first.status).toBe(200)
    const device = first.headers
      .getSetCookie()
      .find((s) => s.startsWith('cairn_device='))!
      .split(';')[0]!
    expect(first.headers.getSetCookie().find((s) => s.startsWith('cairn_device='))).toMatch(
      /Path=\/api\/auth/,
    )

    // Someone guesses from many addresses until the username is locked.
    for (let i = 0; i < 30; i++) expect((await post('guess', `10.8.0.${i}`)).status).toBe(401)
    expect((await post('owner password', '10.7.0.1')).status).toBe(429)

    // The owner's browser still gets in, and its typos don't count against the username.
    expect((await post('typo', '10.9.0.1', device)).status).toBe(401)
    expect((await post('owner password', '10.9.0.1', device)).status).toBe(200)
    // A forged or tampered cookie is no help.
    expect((await post('owner password', '10.7.0.2', 'cairn_device=x.y')).status).toBe(429)
  })
})

describe('client address', () => {
  it('ignores X-Forwarded-For unless the peer is a trusted proxy', async () => {
    const { db } = memoryDb()
    await addUser(db, 'solo', 'solo password')
    // No TRUST_PROXY: every request here has the same (unknown) peer, whatever header it sends.
    const direct = createApp({ sha: 'x', db })
    const post = (ip: string) =>
      direct.request('/api/auth/login', {
        method: 'POST',
        headers: { ...base, 'content-type': 'application/json', 'x-forwarded-for': ip },
        body: JSON.stringify({ username: 'solo', password: 'bad' }),
      })
    for (let i = 0; i < 8; i++) expect((await post(`10.6.0.${i}`)).status).toBe(401)
    expect((await post('10.6.1.1')).status).toBe(429)
  })
})

describe('origin check', () => {
  it('rejects a cross-origin POST, even with JSON', async () => {
    const res = await login(
      { username: 'alice', password: 'correct horse' },
      { origin: 'https://evil.example' },
    )
    expect(res.status).toBe(403)
  })

  it('rejects a browser-declared cross-site POST with no Origin', async () => {
    const res = await login(
      { username: 'alice', password: 'correct horse' },
      { 'sec-fetch-site': 'cross-site' },
    )
    expect(res.status).toBe(403)
  })

  it('allows a same-origin POST', async () => {
    const res = await login(
      { username: 'alice', password: 'correct horse' },
      { origin: `https://${HOST}`, 'x-forwarded-for': '8.8.8.8' },
    )
    expect(res.status).toBe(200)
  })
})
