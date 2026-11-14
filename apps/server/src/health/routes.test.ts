import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '../app.ts'
import { addUser, memoryDb } from '../test-helpers.ts'

const HOST = 'cairn.test'
let app: ReturnType<typeof createApp>
let dataDir: string
const fetchImpl = vi.fn<(url: string) => Promise<Response>>(async () => new Response('ok'))

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'cairn-health-routes-'))
  const { db } = memoryDb()
  await addUser(db, 'boss', 'pw', 'admin')
  await addUser(db, 'plain')
  app = createApp({
    sha: 'x',
    db,
    dataDir,
    notifyFetch: fetchImpl as unknown as typeof fetch,
    trustProxy: () => true,
  })
})
afterAll(() => rmSync(dataDir, { recursive: true, force: true }))

async function as(username: string) {
  const res = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { host: HOST, 'content-type': 'application/json', 'x-forwarded-for': '10.1.1.1' },
    body: JSON.stringify({ username, password: 'pw' }),
  })
  const cookie = res.headers.get('set-cookie')!.split(';')[0]!
  return (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: {
        host: HOST,
        cookie,
        'x-forwarded-for': '10.1.1.1',
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
}

describe('alert routes', () => {
  it('are admin only', async () => {
    const u = await as('plain')
    for (const [m, p] of [
      ['GET', '/api/admin/notifications'],
      ['PUT', '/api/admin/notifications'],
      ['POST', '/api/admin/notifications/test'],
      ['GET', '/api/admin/health'],
    ] as const)
      expect((await u(m, p, m === 'GET' ? undefined : {})).status).toBe(403)
  })

  it('save settings without ever returning the token, and send a test', async () => {
    const a = await as('boss')
    const put = await a('PUT', '/api/admin/notifications', {
      enabled: true,
      url: 'https://ntfy.sh',
      topic: 'my-topic',
      token: 'tk_secret',
    })
    expect(put.status).toBe(200)
    const got = await (await a('GET', '/api/admin/notifications')).text()
    expect(got).not.toContain('tk_secret')
    expect(JSON.parse(got)).toMatchObject({ enabled: true, topic: 'my-topic', hasToken: true })

    const test = await a('POST', '/api/admin/notifications/test')
    expect(await test.json()).toEqual({ ok: true, error: null })
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://ntfy.sh/my-topic')
  })

  it('refuse alerts on without a topic, and a bad URL or topic', async () => {
    const a = await as('boss')
    const base = { enabled: false, url: 'https://ntfy.sh', topic: '' }
    expect((await a('PUT', '/api/admin/notifications', { ...base, enabled: true })).status).toBe(
      400,
    )
    expect((await a('PUT', '/api/admin/notifications', { ...base, url: 'ftp://x' })).status).toBe(
      400,
    )
    expect((await a('PUT', '/api/admin/notifications', { ...base, topic: 'a b/c' })).status).toBe(
      400,
    )
  })

  it('report the live health', async () => {
    const a = await as('boss')
    const h = await (await a('GET', '/api/admin/health')).json()
    expect(h).toMatchObject({ databaseWritable: true })
    expect(Array.isArray(h.problems)).toBe(true)
  })
})
