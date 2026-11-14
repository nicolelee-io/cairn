import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app.ts'
import { createRepos } from './repo/index.ts'
import { addUser, memoryDb } from './test-helpers.ts'

const HOST = 'cairn.test'
let app: ReturnType<typeof createApp>
let db: ReturnType<typeof memoryDb>['db']
let dataDir: string
let aId: string
let bId: string
let a: Client
let b: Client

interface Client {
  (
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<Response>
}

async function client(username: string): Promise<Client> {
  const res = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { host: HOST, 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'pw' }),
  })
  const cookie = res.headers.get('set-cookie')!.split(';')[0]!
  return async (method, path, body, headers = {}) =>
    await app.request(path, {
      method,
      headers: { host: HOST, cookie, 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'cairn-routes-'))
  db = memoryDb().db
  aId = (await addUser(db, 'a')).id
  bId = (await addUser(db, 'b')).id
  app = createApp({ sha: 'x', db, dataDir })
  a = await client('a')
  b = await client('b')
})
afterAll(() => rmSync(dataDir, { recursive: true, force: true }))

const json = async (res: Response) => (await res.json()) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any -- test helper over untyped JSON

async function newJournal(c: Client, name = 'J') {
  const res = await c('POST', '/api/journals', { name })
  expect(res.status).toBe(201)
  return (await json(res)).id as string
}
const entryBody = (journalId: string, extra: object = {}) => ({
  journalId,
  timezone: 'America/Denver',
  bodyMd: 'hello',
  ...extra,
})
async function newEntry(c: Client, journalId: string, extra: object = {}) {
  const res = await c('POST', '/api/entries', entryBody(journalId, extra))
  expect(res.status).toBe(201)
  return (await json(res)).entry.id as string
}

describe('auth', () => {
  it('requires a session for every new route', async () => {
    for (const path of [
      '/api/journals',
      '/api/entries',
      '/api/entries/x',
      '/api/entries/map',
      '/api/entries/recent-places',
      '/api/weather/preview?lat=1&lng=2&at=3',
      '/api/photos/x/thumb',
      '/api/search?q=x',
    ]) {
      expect((await app.request(path)).status).toBe(401)
    }
  })
})

describe('journals', () => {
  it('creates, renames, recolors, archives, unarchives and lists', async () => {
    const id = await newJournal(a, 'Travel')
    let res = await a('PATCH', `/api/journals/${id}`, { name: 'Trips', color: '#7B7B45' })
    expect(await json(res)).toMatchObject({ name: 'Trips', color: '#7B7B45', archivedAt: null })

    res = await a('PATCH', `/api/journals/${id}`, { archived: true })
    expect((await json(res)).archivedAt).toEqual(expect.any(Number))
    const list = (await json(await a('GET', '/api/journals'))) as unknown as {
      id: string
      archivedAt: number | null
    }[]
    expect(list.find((j) => j.id === id)?.archivedAt).not.toBeNull()

    res = await a('PATCH', `/api/journals/${id}`, { archived: false })
    expect((await json(res)).archivedAt).toBeNull()
  })

  it('validates input and replays a create with the same client id', async () => {
    expect((await a('POST', '/api/journals', { name: '   ' })).status).toBe(400)
    expect((await a('POST', '/api/journals', { name: 'x', color: 'green' })).status).toBe(400)
    const id = '0194a3c2-0000-7000-8000-0000000000aa'
    const first = await a('POST', '/api/journals', { id, name: 'Once' })
    const again = await a('POST', '/api/journals', { id, name: 'Once' })
    expect([first.status, again.status]).toEqual([201, 200])
    expect((await json(again)).id).toBe(id)
  })

  it('refuses to reuse the id of a deleted journal', async () => {
    const id = '0194a3c2-0000-7000-8000-0000000000ac'
    expect((await a('POST', '/api/journals', { id, name: 'Gone' })).status).toBe(201)
    expect((await a('DELETE', `/api/journals/${id}`)).status).toBe(204)
    const again = await a('POST', '/api/journals', { id, name: 'Gone' })
    expect([again.status, (await json(again)).error]).toEqual([409, 'id_taken'])
    // Another user's id is no different.
    const other = await a('POST', '/api/journals', {
      id: (await json(await b('POST', '/api/journals', { name: 'B' }))).id,
      name: 'x',
    })
    expect(other.status).toBe(409)
  })

  it("reorders journals, and refuses another user's ids", async () => {
    const x = await newJournal(a, 'X')
    const y = await newJournal(a, 'Y')
    const theirs = await newJournal(b, 'Theirs')
    const res = await a('PUT', '/api/journals/order', { ids: [y, x] })
    expect(res.status).toBe(200)
    const ids = ((await json(res)) as unknown as { id: string }[]).map((j) => j.id)
    expect(ids.indexOf(y)).toBeLessThan(ids.indexOf(x))
    // Another user's id is skipped, never touched.
    expect((await a('PUT', '/api/journals/order', { ids: [x, theirs] })).status).toBe(200)
    expect((await json(await b('GET', '/api/journals')))[0].sortOrder).toBe(0)
    expect((await a('PUT', '/api/journals/order', { ids: [] })).status).toBe(400)
  })

  it('deleting a journal deletes its entries too', async () => {
    const j = await newJournal(a, 'Doomed')
    const e = await newEntry(a, j)
    expect((await a('DELETE', `/api/journals/${j}`)).status).toBe(204)
    expect((await a('GET', `/api/entries/${e}`)).status).toBe(404)
    expect((await a('DELETE', `/api/journals/${j}`)).status).toBe(404)
    const page = await json(await a('GET', '/api/entries?limit=100'))
    expect(page.items.some((i: { id: string }) => i.id === e)).toBe(false)
  })
})

describe('security headers', () => {
  it('sends a CSP and the usual hardening headers, even on API errors', async () => {
    const res = await a('GET', '/api/nope')
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(res.headers.get('content-security-policy')).toContain("script-src 'self'")
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('referrer-policy')).toBeTruthy()
  })
})

describe('entries', () => {
  it('creates idempotently by client id and returns the full detail', async () => {
    const j = await newJournal(a)
    const id = '0194a3c2-0000-7000-8000-0000000000bb'
    const first = await a(
      'POST',
      '/api/entries',
      entryBody(j, { id, mood: 'anxious', starred: true }),
    )
    const again = await a('POST', '/api/entries', entryBody(j, { id, bodyMd: 'different' }))
    expect([first.status, again.status]).toEqual([201, 201])
    const d = await json(again)
    expect(d.entry).toMatchObject({
      id,
      bodyMd: 'hello',
      mood: 'anxious',
      starred: true,
      source: 'native',
    })
    expect(d).toMatchObject({ location: null, weather: null, tags: [], photos: [] })
  })

  it('reads an old 1-5 rating (a queued edit from before mood keys) as its key', async () => {
    const j = await newJournal(a)
    const id = await newEntry(a, j, { mood: 2 })
    expect((await json(await a('GET', `/api/entries/${id}`))).entry.mood).toBe('down')
    const res = await a('PATCH', `/api/entries/${id}`, { mood: 5 })
    expect((await json(res)).entry.mood).toBe('happy')
  })

  it('refuses to reuse the id of a deleted entry', async () => {
    const j = await newJournal(a)
    const id = '0194a3c2-0000-7000-8000-0000000000bc'
    expect((await a('POST', '/api/entries', entryBody(j, { id }))).status).toBe(201)
    expect((await a('DELETE', `/api/entries/${id}`)).status).toBe(204)
    const again = await a('POST', '/api/entries', entryBody(j, { id }))
    expect([again.status, (await json(again)).error]).toEqual([409, 'id_taken'])
  })

  it('rejects bad input', async () => {
    const j = await newJournal(a)
    for (const extra of [
      { mood: 6 },
      { mood: 0 },
      { mood: 'ecstatic' },
      { timezone: 'Mars/Base' },
      { createdAt: -1 },
    ]) {
      expect((await a('POST', '/api/entries', entryBody(j, extra))).status).toBe(400)
    }
    expect((await a('POST', '/api/entries', { journalId: j })).status).toBe(400)
    expect((await a('PATCH', `/api/entries/x`, { mood: 9 })).status).toBe(400)
  })

  it('edits text, date, timezone, flags and mood (and clears mood with null)', async () => {
    const j = await newJournal(a)
    const j2 = await newJournal(a, 'Other')
    const id = await newEntry(a, j, { mood: 'calm' })
    const t = Date.UTC(2020, 0, 2, 3, 4, 5)
    const res = await a('PATCH', `/api/entries/${id}`, {
      bodyMd: 'edited',
      createdAt: t,
      timezone: 'Asia/Tokyo',
      pinned: true,
      allDay: true,
      mood: null,
      journalId: j2,
    })
    expect((await json(res)).entry).toMatchObject({
      bodyMd: 'edited',
      createdAt: t,
      timezone: 'Asia/Tokyo',
      pinned: true,
      allDay: true,
      mood: null,
      journalId: j2,
    })
  })

  it('returns 409 with the current version on a stale baseRev', async () => {
    const j = await newJournal(a)
    const id = await newEntry(a, j)
    const rev = (await json(await a('GET', `/api/entries/${id}`))).entry.rev
    expect((await a('PATCH', `/api/entries/${id}`, { bodyMd: 'v2', baseRev: rev })).status).toBe(
      200,
    )
    const stale = await a('PATCH', `/api/entries/${id}`, { bodyMd: 'v3', baseRev: rev })
    expect(stale.status).toBe(409)
    const body = await json(stale)
    expect(body.error).toBe('conflict')
    expect(body.current.entry.bodyMd).toBe('v2')
    expect((await json(await a('GET', `/api/entries/${id}`))).entry.bodyMd).toBe('v2')
  })

  it('soft-deletes', async () => {
    const id = await newEntry(a, await newJournal(a))
    expect((await a('DELETE', `/api/entries/${id}`)).status).toBe(204)
    expect((await a('GET', `/api/entries/${id}`)).status).toBe(404)
    expect((await a('DELETE', `/api/entries/${id}`)).status).toBe(404)
  })

  it('makes archived journals read-only until unarchived', async () => {
    const j = await newJournal(a, 'Old')
    const id = await newEntry(a, j)
    await a('PATCH', `/api/journals/${j}`, { archived: true })

    const refused = [
      await a('PATCH', `/api/entries/${id}`, { bodyMd: 'nope' }),
      await a('DELETE', `/api/entries/${id}`),
      await a('POST', '/api/entries', entryBody(j)),
    ]
    for (const r of refused) {
      expect(r.status).toBe(409)
      expect((await json(r)).error).toBe('journal_archived')
    }
    const open = await newEntry(a, await newJournal(a, 'Open'))
    const move = await a('PATCH', `/api/entries/${open}`, { journalId: j })
    expect(move.status).toBe(409)
    expect((await a('GET', `/api/entries/${id}`)).status).toBe(200) // still readable

    await a('PATCH', `/api/journals/${j}`, { archived: false })
    expect((await a('PATCH', `/api/entries/${id}`, { bodyMd: 'ok now' })).status).toBe(200)
  })
})

describe('timeline', () => {
  it('pages newest-first with a stable cursor even when created_at ties', async () => {
    const j = await newJournal(b, 'Paged')
    const t = Date.UTC(2024, 5, 1)
    const ids: string[] = []
    for (let i = 0; i < 5; i++) ids.push(await newEntry(b, j, { createdAt: t })) // all the same instant
    ids.push(await newEntry(b, j, { createdAt: t + 1000 }))

    const seen: string[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const res: Response = await b(
        'GET',
        `/api/entries?journalId=${j}&limit=2${cursor ? `&cursor=${cursor}` : ''}`,
      )
      const page = await json(res)
      seen.push(...page.items.map((i: { id: string }) => i.id))
      cursor = page.nextCursor
      pages++
    } while (cursor)
    expect(pages).toBe(3)
    expect(seen).toHaveLength(6)
    expect(new Set(seen)).toEqual(new Set(ids))
    expect(seen[0]).toBe(ids[5]) // newest first
    expect((await b('GET', '/api/entries?cursor=garbage')).status).toBe(400)
  })

  it('hides archived journals unless asked, but shows one browsed explicitly', async () => {
    const j = await newJournal(b, 'Hidden')
    const e = await newEntry(b, j, { bodyMd: 'archived thing' })
    await b('PATCH', `/api/journals/${j}`, { archived: true })
    const ids = async (qs: string) =>
      (await json(await b('GET', `/api/entries?limit=100${qs}`))).items.map(
        (i: { id: string }) => i.id,
      )
    expect(await ids('')).not.toContain(e)
    expect(await ids('&includeArchived=true')).toContain(e)
    expect(await ids(`&journalId=${j}`)).toContain(e)
  })

  it('builds cards with an excerpt, photos, place and weather', async () => {
    const j = await newJournal(a, 'Cards')
    const body =
      '# Title\n\n![](photo:p1) Some **bold** text with a [link](http://x) and \\- an escape.'
    const id = await newEntry(a, j, { bodyMd: body })
    createRepos(db, aId) // (repos are per-user; the card data below goes in through the import path)
    const withExtras = createRepos(db, aId).imports.importEntry({
      sourceId: 'C1',
      journalId: j,
      bodyMd: body,
      createdAt: Date.UTC(2030, 0, 1),
      modifiedAt: 1,
      timezone: 'UTC',
      starred: false,
      pinned: false,
      allDay: false,
      creationDevice: null,
      sourceRaw: '{}',
      tags: [],
      location: { latitude: 1, longitude: 2, placeName: 'Somewhere' },
      weather: { condition: 'rain', source: 'dayone', tempC: 7 },
      photos: [1, 2, 3, 4, 5, 6].map((n) => ({
        id: `card-photo-${n}`,
        position: n,
        originalPath: 'x',
        mime: 'image/jpeg',
        bytes: 1,
        sha256: 'x',
      })),
    })
    expect(withExtras).toBe('imported')

    const items = (await json(await a('GET', `/api/entries?journalId=${j}`))).items
    const card = items[0]
    expect(card).toMatchObject({
      title: 'Title',
      excerpt: 'Some bold text with a link and - an escape.',
      photoCount: 6,
      placeName: 'Somewhere',
      weather: { condition: 'rain', tempC: 7 },
    })
    expect(card.photos).toHaveLength(4)
    expect(card.photos.map((p: { position: number }) => p.position)).toEqual([1, 2, 3, 4])
    expect(items.find((i: { id: string }) => i.id === id).photoCount).toBe(0)
  })

  it('does not leak internal fields', async () => {
    const j = await newJournal(a)
    const id = await newEntry(a, j)
    const text = await (await a('GET', `/api/entries/${id}`)).text()
    for (const secret of [
      'sourceRaw',
      'source_raw',
      'userId',
      'originalPath',
      'sha256',
      'deletedAt',
    ]) {
      expect(text).not.toContain(secret)
    }
  })
})

describe('photos', () => {
  const sha = 'abc123'
  let photoId: string
  const put = (rel: string, body: string) => {
    mkdirSync(dirname(join(dataDir, rel)), { recursive: true })
    writeFileSync(join(dataDir, rel), body)
  }

  beforeAll(async () => {
    const j = await newJournal(a, 'Pics')
    put(`photos/${aId}/originals/${sha}.jpg`, 'ORIGINAL')
    put(`photos/${aId}/display/${sha}.webp`, 'DISPLAY')
    put(`photos/${aId}/thumb/${sha}.webp`, 'THUMB')
    put(`photos/${bId}/originals/${sha}.jpg`, 'B-PRIVATE') // exists, so only the path guard stops it
    createRepos(db, aId).imports.importEntry({
      sourceId: 'P1',
      journalId: j,
      bodyMd: '',
      createdAt: 1,
      modifiedAt: 1,
      timezone: 'UTC',
      starred: false,
      pinned: false,
      allDay: false,
      creationDevice: null,
      sourceRaw: '{}',
      tags: [],
      location: null,
      weather: null,
      photos: [
        {
          id: 'serve-me',
          position: 0,
          originalPath: `photos/${aId}/originals/${sha}.jpg`,
          displayPath: `photos/${aId}/display/${sha}.webp`,
          thumbPath: `photos/${aId}/thumb/${sha}.webp`,
          mime: 'image/jpeg',
          bytes: 8,
          sha256: sha,
        },
        {
          id: 'no-derivs',
          position: 1,
          originalPath: `photos/${aId}/originals/${sha}.jpg`,
          mime: 'image/jpeg',
          bytes: 8,
          sha256: sha,
        },
        {
          id: 'escapes',
          position: 2,
          originalPath: `photos/${bId}/originals/${sha}.jpg`, // someone else's folder
          mime: 'image/jpeg',
          bytes: 8,
          sha256: sha,
        },
      ],
    })
    photoId = 'serve-me'
  })

  it('serves each variant with the right type and long-lived private caching', async () => {
    for (const [variant, body, type] of [
      ['original', 'ORIGINAL', 'image/jpeg'],
      ['display', 'DISPLAY', 'image/webp'],
      ['thumb', 'THUMB', 'image/webp'],
    ] as const) {
      const res = await a('GET', `/api/photos/${photoId}/${variant}`)
      expect(res.status).toBe(200)
      expect(await res.text()).toBe(body)
      expect(res.headers.get('content-type')).toBe(type)
      expect(res.headers.get('cache-control')).toContain('private')
      expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    }
  })

  it('answers 304 for a matching ETag', async () => {
    const first = await a('GET', `/api/photos/${photoId}/thumb`)
    const res = await a('GET', `/api/photos/${photoId}/thumb`, undefined, {
      'if-none-match': first.headers.get('etag')!,
    })
    expect(res.status).toBe(304)
  })

  it('falls back to the original when there are no derivatives', async () => {
    const res = await a('GET', '/api/photos/no-derivs/thumb')
    expect(await res.text()).toBe('ORIGINAL')
    expect(res.headers.get('content-type')).toBe('image/jpeg')
  })

  it("404s for another user's photo, unknown variants, unknown ids, and out-of-folder paths", async () => {
    expect((await b('GET', `/api/photos/${photoId}/original`)).status).toBe(404)
    expect((await a('GET', `/api/photos/${photoId}/huge`)).status).toBe(404)
    expect((await a('GET', '/api/photos/nope/thumb')).status).toBe(404)
    expect((await a('GET', '/api/photos/escapes/original')).status).toBe(404)
  })
})

describe('cross-user access over HTTP', () => {
  it("B gets 404 for A's journals and entries, and cannot write into them", async () => {
    const j = await newJournal(a, 'Private')
    const id = await newEntry(a, j, { bodyMd: 'secret' })

    expect((await b('GET', `/api/entries/${id}`)).status).toBe(404)
    expect((await b('PATCH', `/api/entries/${id}`, { bodyMd: 'pwned' })).status).toBe(404)
    expect((await b('DELETE', `/api/entries/${id}`)).status).toBe(404)
    expect((await b('PATCH', `/api/journals/${j}`, { name: 'pwned' })).status).toBe(404)
    expect((await b('DELETE', `/api/journals/${j}`)).status).toBe(404)
    expect((await b('POST', '/api/entries', entryBody(j))).status).toBe(404)

    const list = (await json(await b('GET', '/api/journals'))) as unknown as { id: string }[]
    expect(list.some((x) => x.id === j)).toBe(false)
    const page = await json(await b('GET', `/api/entries?journalId=${j}&includeArchived=true`))
    expect(page.items).toEqual([])
    expect((await json(await a('GET', `/api/entries/${id}`))).entry.bodyMd).toBe('secret')
  })

  it("B cannot claim A's client-supplied entry id", async () => {
    const id = await newEntry(a, await newJournal(a))
    const own = await newJournal(b)
    const res = await b('POST', '/api/entries', entryBody(own, { id }))
    expect(res.status).toBe(409)
    expect((await json(res)).error).toBe('id_taken')
  })
})

describe('profile settings', () => {
  it('keeps the temperature unit on the account, defaulting to F', async () => {
    await addUser(db, 'unit')
    const c = await client('unit')
    expect((await json(await c('GET', '/api/auth/me'))).tempUnit).toBe('F')
    const res = await c('PATCH', '/api/auth/me', { tempUnit: 'C' })
    expect((await json(res)).tempUnit).toBe('C')
    expect((await json(await c('GET', '/api/auth/me'))).tempUnit).toBe('C')
    expect((await c('PATCH', '/api/auth/me', { tempUnit: 'K' })).status).toBe(400)
    expect((await json(await c('GET', '/api/auth/me'))).autoLocation).toBe(false)
    expect(
      (await json(await c('PATCH', '/api/auth/me', { autoLocation: true }))).autoLocation,
    ).toBe(true)
    expect((await json(await c('GET', '/api/auth/me'))).tempUnit).toBe('C') // untouched
    expect((await json(await c('GET', '/api/auth/me'))).showArchivedInMenu).toBe(true)
    expect(
      (await json(await c('PATCH', '/api/auth/me', { showArchivedInMenu: false })))
        .showArchivedInMenu,
    ).toBe(false)
    expect(
      (await json(await client('a').then((a) => a('GET', '/api/auth/me')))).showArchivedInMenu,
    ).toBe(true)
    expect((await json(await client('a').then((a) => a('GET', '/api/auth/me')))).tempUnit).toBe('F')
  })

  it('keeps the streak switches per account, on by default', async () => {
    await addUser(db, 'streak')
    const c = await client('streak')
    const me = await json(await c('GET', '/api/auth/me'))
    expect([me.showStreak, me.showBestStreak]).toEqual([true, true])
    const off = await json(await c('PATCH', '/api/auth/me', { showStreak: false }))
    expect([off.showStreak, off.showBestStreak]).toEqual([false, true])
    expect((await c('PATCH', '/api/auth/me', { showBestStreak: 'no' })).status).toBe(400)
    const other = await client('a').then((a) => a('GET', '/api/auth/me'))
    expect((await json(other)).showStreak).toBe(true)
  })
})

describe('default journal and counts', () => {
  const me = async (c: Client) => json(await c('GET', '/api/auth/me'))

  it('is null until a journal exists, then the first active journal, and can be chosen', async () => {
    await addUser(db, 'c')
    const c = await client('c')
    expect((await me(c)).defaultJournalId).toBeNull()

    const first = await newJournal(c, 'First')
    const second = await newJournal(c, 'Second')
    expect((await me(c)).defaultJournalId).toBe(first)

    const res = await c('PATCH', '/api/auth/me', { defaultJournalId: second })
    expect((await json(res)).defaultJournalId).toBe(second)
    expect((await me(c)).defaultJournalId).toBe(second)

    // Archiving or deleting the chosen journal falls back to the first active one.
    await c('PATCH', `/api/journals/${second}`, { archived: true })
    expect((await me(c)).defaultJournalId).toBe(first)
    await c('PATCH', `/api/journals/${second}`, { archived: false })
    expect((await me(c)).defaultJournalId).toBe(second)
    await c('DELETE', `/api/journals/${second}`)
    expect((await me(c)).defaultJournalId).toBe(first)

    // null clears the choice.
    const third = await newJournal(c, 'Third')
    await c('PATCH', '/api/auth/me', { defaultJournalId: third })
    expect(
      (await json(await c('PATCH', '/api/auth/me', { defaultJournalId: null }))).defaultJournalId,
    ).toBe(first)
  })

  it('refuses archived, deleted, unknown and other users’ journals', async () => {
    const c = await client('c')
    const archived = await newJournal(c, 'Old')
    await c('PATCH', `/api/journals/${archived}`, { archived: true })
    const res = await c('PATCH', '/api/auth/me', { defaultJournalId: archived })
    expect([res.status, (await json(res)).error]).toEqual([409, 'journal_archived'])

    const gone = await newJournal(c, 'Gone')
    await c('DELETE', `/api/journals/${gone}`)
    expect((await c('PATCH', '/api/auth/me', { defaultJournalId: gone })).status).toBe(404)
    expect((await c('PATCH', '/api/auth/me', { defaultJournalId: 'nope' })).status).toBe(404)

    const aJournal = await newJournal(a, 'A only')
    expect((await c('PATCH', '/api/auth/me', { defaultJournalId: aJournal })).status).toBe(404)
    expect((await me(a)).defaultJournalId).not.toBe(null)
  })

  it('reports live entry counts per journal', async () => {
    const j = await newJournal(a, 'Counted')
    const e1 = await newEntry(a, j)
    await newEntry(a, j)
    const count = async () =>
      (
        (await json(await a('GET', '/api/journals'))) as unknown as {
          id: string
          entryCount: number
        }[]
      ).find((x) => x.id === j)?.entryCount
    expect(await count()).toBe(2)
    await a('DELETE', `/api/entries/${e1}`)
    expect(await count()).toBe(1)
  })
})

describe('search', () => {
  it('finds entries with snippets, edits included, and only for the signed-in user', async () => {
    const j = await newJournal(a, 'Searchable')
    const e = await newEntry(a, j)
    await a('PATCH', `/api/entries/${e}`, {
      bodyMd: '# Trail notes\n\nWalked along the zeppelin trail',
    })

    const res = await a('GET', '/api/search?q=zeppelins')
    expect(res.status).toBe(200)
    const page = await json(res)
    expect(page.nextCursor).toBeNull()
    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toMatchObject({ id: e, journalId: j })
    expect(page.items[0].snippet).toContain('zeppelin')
    expect(page.items[0].titleMarked).toBe('Trail notes')

    const matches = await json(await a('GET', `/api/search/matches?q=zeppelins&entryId=${e}`))
    expect(matches).toEqual({ words: ['zeppelin'] })
    expect(await json(await b('GET', `/api/search/matches?q=zeppelins&entryId=${e}`))).toEqual({
      words: [],
    })
    expect((await a('GET', '/api/search/matches?q=zeppelin')).status).toBe(400)
    expect(page.items[0]).not.toHaveProperty('bodyMd')

    expect((await json(await b('GET', '/api/search?q=zeppelin'))).items).toEqual([])
  })

  it('validates the query string', async () => {
    for (const qs of [
      '',
      'q=',
      'q=x&sort=best',
      'q=x&limit=0',
      'q=x&starred=maybe',
      'q=x&cursor=nope',
    ]) {
      expect((await a('GET', `/api/search?${qs}`)).status, qs).toBe(400)
    }
    // Starred alone is a valid listing of starred entries.
    expect((await a('GET', '/api/search?starred=true')).status).toBe(200)
    // Only punctuation: nothing to search for, which is an empty result, not an error.
    expect(await json(await a('GET', '/api/search?q=***'))).toEqual({ items: [], nextCursor: null })
  })
})

describe('insights', () => {
  it('needs a session and valid dates', async () => {
    const anon = await app.request('/api/insights/stats?today=2026-10-31', {
      headers: { host: HOST },
    })
    expect(anon.status).toBe(401)
    for (const path of [
      '/api/insights/stats',
      '/api/insights/stats?today=2026-02-30',
      '/api/insights/stats?today=2026-10-31&range=year',
      '/api/insights/month?month=2026-13',
      '/api/insights/on-this-day?date=yesterday',
      '/api/insights/day?date=2026-13-01',
    ]) {
      expect((await a('GET', path)).status, path).toBe(400)
    }
    expect((await a('GET', '/api/insights/stats?today=2026-10-31&range=week')).status).toBe(200)
    expect(await json(await a('GET', '/api/insights/on-this-day?date=2026-10-31'))).toHaveProperty(
      'years',
    )
  })
})
