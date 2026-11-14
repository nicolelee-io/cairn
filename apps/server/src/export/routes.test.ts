import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../app.ts'
import { addUser, memoryDb } from '../test-helpers.ts'

const base = { host: 'cairn.test' }
let app: ReturnType<typeof createApp>
let dataDir: string
let cookie: string

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'cairn-export-route-'))
  const { db } = memoryDb()
  await addUser(db, 'alice', 'correct horse')
  app = createApp({ sha: 'abc', db, dataDir })
  const res = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { ...base, 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'alice', password: 'correct horse' }),
  })
  cookie = res.headers.get('set-cookie')!.split(';')[0]!
})
afterAll(() => rmSync(dataDir, { recursive: true, force: true }))

describe('export routes', () => {
  it('404 for a journal that is not the signed-in user’s', async () => {
    const res = await app.request('/api/export?journalId=nope', {
      headers: { ...base, cookie },
    })
    expect(res.status).toBe(404)
  })

  it('need a session', async () => {
    expect((await app.request('/api/export')).status).toBe(401)
  })

  it('download a zip, named for JSON-only and for one journal', async () => {
    for (const [path, name] of [
      ['/api/export', /^cairn-export-\d{4}-\d\d-\d\d\.zip$/],
      ['/api/export?media=0', /^cairn-export-\d{4}-\d\d-\d\d-json\.zip$/],
    ] as const) {
      const res = await app.request(path, { headers: { ...base, cookie } })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('application/zip')
      expect(res.headers.get('content-disposition')).toMatch(`filename="`)
      expect(res.headers.get('content-disposition')!.match(/filename="(.*)"/)![1]).toMatch(name)
      expect(res.headers.get('cache-control')).toBe('no-store')
      const bytes = new Uint8Array(await res.arrayBuffer())
      expect(String.fromCharCode(bytes[0]!, bytes[1]!)).toBe('PK')
    }
  })

  it('one entry: 404 for one that is not there, a zip for one that is', async () => {
    expect(
      (await app.request('/api/export/entries/nope', { headers: { ...base, cookie } })).status,
    ).toBe(404)
    expect((await app.request('/api/export/entries/nope')).status).toBe(401)
    const created = await app.request('/api/journals', {
      method: 'POST',
      headers: { ...base, cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'J' }),
    })
    const journal = (await created.json()) as { id: string }
    const entry = await app.request('/api/entries', {
      method: 'POST',
      headers: { ...base, cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ journalId: journal.id, bodyMd: '# Hello there', timezone: 'UTC' }),
    })
    const { id } = ((await entry.json()) as { entry: { id: string } }).entry
    expect(entry.status).toBeLessThan(300)
    const res = await app.request(`/api/export/entries/${id}`, { headers: { ...base, cookie } })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/zip')
    expect(res.headers.get('content-disposition')).toMatch(
      /cairn-entry-\d{4}-\d\d-\d\d-hello-there\.zip/,
    )
  })
})
