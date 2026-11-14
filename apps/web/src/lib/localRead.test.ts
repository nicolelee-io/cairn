import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TimelineItemSchema, EntryDetailSchema, type SyncEntry } from '@cairn/shared'
import { z } from 'zod'
import { api } from './api.ts'
import { deleteLocalDb, localDb, setActiveUser } from './localDb.ts'
import { localRead } from './localRead.ts'
import { enqueue } from './outbox.ts'

const U = 'u1'

const entry = (id: string, journalId: string, createdAt: number, body = `Title ${id}\n\nbody`) =>
  ({
    entry: {
      id,
      journalId,
      bodyMd: body,
      createdAt,
      modifiedAt: createdAt,
      timezone: 'UTC',
      starred: false,
      pinned: false,
      allDay: false,
      mood: null,
      moodSuggested: null,
      creationDevice: null,
      source: 'native',
      rev: 1,
    },
    location: null,
    weather: null,
    tags: [],
  }) satisfies SyncEntry

async function seed() {
  const db = localDb(U)
  const j = (id: string, archivedAt: number | null = null) => ({
    id,
    name: id,
    color: null,
    icon: null,
    description: null,
    archivedAt,
    sortOrder: 0,
    createdAt: 1,
    rev: 1,
  })
  await db.journals.bulkPut([j('a'), j('b'), j('old', 5)])
  await db.meta.put({ key: 'offline', value: ['a', 'old'] })
  const rows = [
    entry('e1', 'a', 100),
    entry('e2', 'a', 200),
    entry('e3', 'a', 200), // same instant as e2: the id breaks the tie
    entry('e4', 'old', 300),
    {
      ...entry('e5', 'a', 50),
      location: {
        latitude: 1,
        longitude: 2,
        placeName: 'Here',
        locality: null,
        region: null,
        country: null,
        address: null,
        googlePlaceId: null,
      },
    },
  ]
  await db.entries.bulkPut(
    rows.map((e) => ({
      ...e,
      id: e.entry.id,
      journalId: e.entry.journalId,
      createdAt: e.entry.createdAt,
    })),
  )
  await db.photos.bulkPut(
    ['p1', 'p2'].map((id, position) => ({
      id,
      entryId: 'e2',
      position: 1 - position,
      width: 1,
      height: 1,
      takenAt: null,
      latitude: null,
      longitude: null,
      rev: 1,
    })),
  )
  await db.attachments.put({
    id: 'f1',
    entryId: 'e1',
    kind: 'pdf',
    position: 0,
    filename: 'f1.pdf',
    mime: 'application/pdf',
    bytes: 1,
    rev: 1,
  })
}

beforeEach(async () => {
  setActiveUser(U)
  await seed()
})
afterEach(async () => {
  setActiveUser(null)
  vi.unstubAllGlobals()
  await deleteLocalDb(U)
})

const ids = (r: unknown) => (r as { items: { id: string }[] }).items.map((i) => i.id)

describe('localRead', () => {
  it('answers an entry in the server shape, photos in order', async () => {
    const d = EntryDetailSchema.parse(await localRead(U, '/entries/e2', false))
    expect(d.entry.id).toBe('e2')
    expect(d.photos.map((p) => p.id)).toEqual(['p2', 'p1'])
    expect(await localRead(U, '/entries/nope', false)).toBeUndefined()
    expect(await localRead(U, '/entries/map', false)).toBeUndefined()
  })

  it('filters the list by tag ignoring case, and counts tags on the device', async () => {
    const db = localDb(U)
    await db.entries.update('e1', { tags: ['Trip', 'food'] })
    await db.entries.update('e2', { tags: ['trip'] })
    await db.entries.update('e4', { tags: ['trip'] }) // in 'old', which is kept too
    expect(ids(await localRead(U, '/entries?tag=TRIP', false))).toEqual(['e2', 'e1'])
    expect(ids(await localRead(U, '/entries?tag=nope', false))).toEqual([])
    expect(await localRead(U, '/tags', false)).toEqual({
      tags: [
        { name: 'Trip', count: 3 },
        { name: 'food', count: 1 },
      ],
    })
  })

  it('lists newest first with the id breaking ties, hiding archived journals', async () => {
    const r = await localRead(U, '/entries', false)
    z.object({ items: z.array(TimelineItemSchema) }).parse(r)
    expect(ids(r)).toEqual(['e3', 'e2', 'e1', 'e5'])
    expect(ids(await localRead(U, '/entries?includeArchived=true', false))).toEqual([
      'e4',
      'e3',
      'e2',
      'e1',
      'e5',
    ])
    expect(ids(await localRead(U, '/entries?journalId=old', false))).toEqual(['e4'])
  })

  it('builds cards like the server: title, excerpt, photos, attachments, place', async () => {
    const r = (await localRead(U, '/entries', false)) as {
      items: z.infer<typeof TimelineItemSchema>[]
    }
    const e2 = r.items.find((i) => i.id === 'e2')!
    expect(e2).toMatchObject({ title: 'Title e2', excerpt: 'body', photoCount: 2 })
    expect(r.items.find((i) => i.id === 'e5')!.placeName).toBe('Here')
    expect(r.items.filter((i) => i.hasAttachments).map((i) => i.id)).toEqual(['e1'])
    const d = EntryDetailSchema.parse(await localRead(U, '/entries/e1', false))
    expect(d.attachments.map((a) => a.filename)).toEqual(['f1.pdf'])
  })

  it('pages with the server cursor format', async () => {
    const first = (await localRead(U, '/entries?limit=2', false)) as { nextCursor: string | null }
    expect(ids(first)).toEqual(['e3', 'e2'])
    expect(first.nextCursor).toBe('200_e2')
    const second = (await localRead(U, `/entries?limit=2&cursor=${first.nextCursor}`, false)) as {
      nextCursor: string | null
    }
    expect(ids(second)).toEqual(['e1', 'e5'])
    expect(second.nextCursor).toBeNull()
  })

  it('sorts pinned entries first and pages across the pinned/unpinned boundary', async () => {
    const db = localDb(U)
    const e1 = (await db.entries.get('e1'))!
    await db.entries.put({ ...e1, entry: { ...e1.entry, pinned: true } })
    const first = (await localRead(U, '/entries?limit=2', false)) as { nextCursor: string | null }
    expect(ids(first)).toEqual(['e1', 'e3'])
    expect(first.nextCursor).toBe('200_e3')
    const second = (await localRead(U, `/entries?limit=2&cursor=${first.nextCursor}`, false)) as {
      nextCursor: string | null
    }
    expect(ids(second)).toEqual(['e2', 'e5'])
    const one = (await localRead(U, '/entries?limit=1', false)) as { nextCursor: string | null }
    expect(one.nextCursor).toBe('P100_e1')
    const next = (await localRead(U, `/entries?limit=1&cursor=${one.nextCursor}`, false)) as {
      nextCursor: string | null
    }
    expect(ids(next)).toEqual(['e3'])
  })

  it('does not answer for a journal that is not kept, or with nothing kept', async () => {
    expect(await localRead(U, '/entries?journalId=b', false)).toBeUndefined()
    await localDb(U).meta.put({ key: 'offline', value: [] })
    expect(await localRead(U, '/entries', false)).toBeUndefined()
    expect(await localRead(null, '/entries', false)).toBeUndefined()
  })

  it('answers the journal list only when the worker has no cached one', async () => {
    expect(await localRead(U, '/journals', true)).toBeUndefined()
    const js = (await localRead(U, '/journals', false)) as { id: string; entryCount: number }[]
    expect(js.find((j) => j.id === 'a')!.entryCount).toBe(4)
  })
})

describe('api() with a copy on the device', () => {
  it('reads the entry locally when the server is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const d = await api('/entries/e1', { schema: EntryDetailSchema })
    expect(d.entry.id).toBe('e1')
  })

  it('reads locally when the gateway says the app is down', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('bad gateway', { status: 502 })),
    )
    expect(ids(await api('/entries'))).toContain('e1')
  })

  it('prefers the local copy to a stale reply from the service worker', async () => {
    await localDb(U).entries.update('e1', {
      entry: { ...entry('e1', 'a', 100).entry, bodyMd: 'newer, local' },
    })
    const stale = { ...entry('e1', 'a', 100), photos: [] }
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(stale), { status: 200, headers: { 'x-cairn-offline': '1' } }),
      ),
    )
    const d = await api('/entries/e1', { schema: EntryDetailSchema })
    expect(d.entry.bodyMd).toBe('newer, local')
  })

  it('still throws when there is no copy to fall back on', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(api('/entries/zzz')).rejects.toThrow()
  })

  it('never answers a write from the copy', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(api('/entries/e1', { method: 'PATCH', body: {} })).rejects.toThrow()
  })

  it('shows an entry written offline in the list it reads from the copy', async () => {
    await enqueue(U, {
      target: 'new',
      entryId: 'n1',
      method: 'POST',
      path: '/entries',
      body: { id: 'n1', journalId: 'a', bodyMd: 'Brand new', timezone: 'UTC', createdAt: 9_999 },
      queuedAt: 1,
      draft: null,
    })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const r = await api('/entries?journalId=a')
    expect(ids(r)[0]).toBe('n1')
    expect(ids(r)).toContain('e1')
  })
})

describe('local search', () => {
  const searchIds = async (qs: string) => ids(await localRead(U, `/search?${qs}`, false))

  beforeEach(async () => {
    const db = localDb(U)
    await db.entries.update('e1', {
      entry: {
        ...entry('e1', 'a', 100, '# Heron day\n\nA heron by the café').entry,
        starred: true,
      },
      tags: ['Birds'],
    })
    await db.entries.update('e2', {
      entry: entry('e2', 'a', 200, '# Another\n\nheron again').entry,
    })
    await db.entries.update('e4', {
      entry: entry('e4', 'old', 300, '# Archived one\n\nheron in the archive').entry,
    })
    await db.entries.update('e3', {
      entry: entry('e3', 'a', 200, '# Third\n\nno bird here').entry,
    })
  })

  it('finds entries newest first, ignoring accents, and leaves archived journals out', async () => {
    expect(await searchIds('q=heron')).toEqual(['e2', 'e1'])
    expect(await searchIds('q=cafe')).toEqual(['e1'])
    expect(await searchIds('q=heron&includeArchived=true')).toEqual(['e4', 'e2', 'e1'])
    expect(await searchIds('q=heron&journalId=old')).toEqual(['e4'])
    expect(await searchIds('q=heron&sort=relevance')).toEqual(['e2', 'e1']) // newest first
  })

  it('answers in the server shape with marked snippets', async () => {
    const page = (await localRead(U, '/search?q=heron', false)) as {
      items: { snippet: string; titleMarked: string; snippetField: string; photoCount: number }[]
    }
    expect(page.items[0]!.snippet).toContain('\uE000heron\uE001')
    expect(page.items[1]!.titleMarked).toBe('\uE000Heron\uE001 day')
    expect(page.items[0]).toMatchObject({ snippetField: 'body' })
    expect(page.items[0]!.photoCount).toBe(2)
  })

  it('filters by starred, tag (ignoring case) and attachments, with no words needed', async () => {
    expect(await searchIds('starred=true')).toEqual(['e1'])
    expect(await searchIds('tag=birds')).toEqual(['e1'])
    expect(await searchIds('attachments=true')).toEqual(['e1'])
    expect(await searchIds('q=heron&tag=nope')).toEqual([])
    expect(await searchIds('q=')).toEqual([])
  })

  it('pages with an offset cursor', async () => {
    const first = (await localRead(U, '/search?q=heron&limit=1', false)) as {
      items: { id: string }[]
      nextCursor: string
    }
    expect(first.items.map((i) => i.id)).toEqual(['e2'])
    expect(first.nextCursor).toBe('o1')
    const second = (await localRead(
      U,
      `/search?q=heron&limit=1&cursor=${first.nextCursor}`,
      false,
    )) as {
      items: { id: string }[]
      nextCursor: string | null
    }
    expect(second.items.map((i) => i.id)).toEqual(['e1'])
    expect(second.nextCursor).toBeNull()
    expect(await localRead(U, '/search?q=heron&cursor=bad', false)).toBeUndefined()
  })

  it('reports the words of one entry the query matched', async () => {
    expect(await localRead(U, '/search/matches?q=heron%20cafe&entryId=e1', false)).toEqual({
      words: expect.arrayContaining(['heron', 'café']),
    })
    expect(await localRead(U, '/search/matches?q=heron&entryId=nope', false)).toBeUndefined()
  })

  it('cannot answer when no journal is kept', async () => {
    await localDb(U).meta.put({ key: 'offline', value: [] })
    expect(await localRead(U, '/search?q=heron', false)).toBeUndefined()
  })
})
