import { beforeAll, describe, expect, it } from 'vitest'
import { SyncChangesSchema, SyncEstimateSchema } from '@cairn/shared'
import { createApp } from '../app.ts'
import { addUser, memoryDb } from '../test-helpers.ts'

const HOST = 'cairn.test'
let app: ReturnType<typeof createApp>

beforeAll(async () => {
  const { db } = memoryDb()
  await addUser(db, 'a')
  app = createApp({ sha: 'x', db })
})

async function session() {
  const res = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { host: HOST, 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'a', password: 'pw' }),
  })
  return res.headers.get('set-cookie')!.split(';')[0]!
}

const get = (path: string, cookie?: string) =>
  app.request(path, { headers: { host: HOST, ...(cookie ? { cookie } : {}) } })

describe('GET /api/sync/changes', () => {
  it('needs a session', async () => {
    expect((await get('/api/sync/changes')).status).toBe(401)
  })

  it('returns a page that matches the shared schema, and follows its own cursor', async () => {
    const cookie = await session()
    const post = (path: string, body: unknown) =>
      app.request(path, {
        method: 'POST',
        headers: { host: HOST, cookie, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    const j = (await (await post('/api/journals', { name: 'Main' })).json()) as { id: string }
    await post('/api/entries', { journalId: j.id, bodyMd: 'hello', timezone: 'UTC' })

    const first = SyncChangesSchema.parse(await (await get('/api/sync/changes', cookie)).json())
    expect(first.journals).toHaveLength(1)
    expect(first.entries).toHaveLength(1)
    expect(first.entries[0]!.entry.bodyMd).toBe('hello')
    expect(first.hasMore).toBe(false)

    const next = SyncChangesSchema.parse(
      await (await get(`/api/sync/changes?since=${first.cursor}`, cookie)).json(),
    )
    expect(next.entries).toEqual([])
    expect(next.journals).toEqual([])
  })

  it('rejects bad parameters', async () => {
    const cookie = await session()
    for (const q of ['since=-1', 'since=abc', 'limit=0', 'limit=100000'])
      expect((await get(`/api/sync/changes?${q}`, cookie)).status).toBe(400)
  })
})

describe('GET /api/sync/estimate', () => {
  it("counts a journal's entries and text bytes, and nobody else's", async () => {
    const cookie = await session()
    const post = (path: string, body: unknown) =>
      app.request(path, {
        method: 'POST',
        headers: { host: HOST, cookie, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    const j = (await (await post('/api/journals', { name: 'Sized' })).json()) as { id: string }
    await post('/api/entries', { journalId: j.id, bodyMd: 'héllo', timezone: 'UTC' })
    const res = await get('/api/sync/estimate', cookie)
    const body = SyncEstimateSchema.parse(await res.json())
    const mine = body.journals.find((x) => x.journalId === j.id)!
    expect(mine).toMatchObject({ entries: 1, textBytes: 6, photos: 0, photoBytes: 0 })
    expect((await get('/api/sync/estimate')).status).toBe(401)
  })
})
