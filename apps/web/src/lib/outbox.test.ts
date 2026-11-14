import 'fake-indexeddb/auto'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EntryDetail } from '@cairn/shared'
import { loadDraft } from './draft.ts'
import { deleteLocalDb, localDb, setActiveUser } from './localDb.ts'
import {
  enqueue,
  fetchEntry,
  flushOutbox,
  isUnreachable,
  loadOutbox,
  matchesQueued,
  pendingCreateDetail,
  outboxState,
  sendOrQueue,
  withPendingCards,
  withPendingEdits,
  type OutboxItem,
} from './outbox.ts'
import { ApiError } from './api.ts'

function fakeStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() {
      return m.size
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  }
}

const draft = {
  newId: null,
  journalId: 'j1',
  bodyMd: 'hello',
  createdAt: 1_000,
  timezone: 'UTC',
  allDay: false,
  starred: false,
  pinned: false,
  mood: null,
  location: null,
  weather: null,
  baseRev: 3,
}

const patch = (body: Record<string, unknown>, id = 'e1'): OutboxItem => ({
  target: id,
  entryId: id,
  method: 'PATCH',
  path: `/entries/${id}`,
  body: { baseRev: 3, ...body },
  queuedAt: 1,
  draft: { ...draft, bodyMd: String(body.bodyMd ?? 'hello') },
})

const detailJson = (id: string, rev: number) => ({
  entry: {
    id,
    journalId: 'j1',
    bodyMd: 'from server',
    createdAt: 1_000,
    modifiedAt: 1_000,
    timezone: 'UTC',
    allDay: false,
    starred: false,
    pinned: false,
    mood: null,
    moodSuggested: null,
    creationDevice: null,
    source: 'native',
    rev,
  },
  location: null,
  weather: null,
  tags: [],
  photos: [],
})

let ls: Storage

beforeEach(() => {
  ls = fakeStorage()
  vi.stubGlobal('localStorage', ls)
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(['u1', 'u2'].map(deleteLocalDb))
})

describe('enqueue', () => {
  it('folds a second edit of the same entry into the first, keeping the first baseRev', async () => {
    await enqueue('u1', patch({ bodyMd: 'one', baseRev: 3, removePhotoIds: ['a'] }))
    await enqueue('u1', patch({ bodyMd: 'two', starred: true, baseRev: 3, removeMediaIds: ['b'] }))
    const items = await loadOutbox('u1')
    expect(items).toHaveLength(1)
    expect(items[0]!.body).toMatchObject({ bodyMd: 'two', starred: true, baseRev: 3 })
    expect(items[0]!.body.removeMediaIds).toEqual(['a', 'b']) // 'a' queued under the old name
    expect(outboxState().pending).toBe(1)
  })

  it('keeps different entries separate, in order, and per user', async () => {
    await enqueue('u1', patch({ bodyMd: 'a' }, 'e1'))
    await enqueue('u1', patch({ bodyMd: 'b' }, 'e2'))
    expect((await loadOutbox('u1')).map((x) => x.entryId)).toEqual(['e1', 'e2'])
    expect(await loadOutbox('u2')).toHaveLength(0)
  })

  it('reports failure when the database is unavailable', async () => {
    localDb('u1').close()
    expect(await enqueue('u1', patch({}))).toBe(false)
  })
})

describe('withPendingEdits', () => {
  it('lays the waiting values over the server copy', async () => {
    await enqueue('u1', patch({ bodyMd: 'mine', starred: true }))
    const server = detailJson('e1', 3) as unknown as EntryDetail
    const merged = await withPendingEdits('u1', server)
    expect(merged.entry.bodyMd).toBe('mine')
    expect(merged.entry.starred).toBe(true)
    expect(merged.entry.rev).toBe(3)
    expect(await withPendingEdits('u2', server)).toBe(server)
  })

  it('shows waiting tags, and leaves the server tags alone when none are queued', async () => {
    const server = { ...detailJson('e1', 3), tags: ['old'] } as unknown as EntryDetail
    await enqueue('u1', patch({ starred: true }))
    expect((await withPendingEdits('u1', server)).tags).toEqual(['old'])
    await enqueue('u1', patch({ tags: ['a', 'b'] }))
    expect((await withPendingEdits('u1', server)).tags).toEqual(['a', 'b'])
  })

  it('shows a waiting place and weather, and an `auto` weather as none until it is fetched', async () => {
    const place = {
      latitude: 1,
      longitude: 2,
      placeName: 'Park',
      locality: null,
      region: null,
      country: null,
      address: null,
      googlePlaceId: null,
    }
    const server = detailJson('e1', 3) as unknown as EntryDetail
    await enqueue(
      'u1',
      patch({ location: place, weather: { condition: 'rain', tempC: 4, isDay: true } }),
    )
    const merged = await withPendingEdits('u1', server)
    expect(merged.location?.placeName).toBe('Park')
    expect(merged.weather).toMatchObject({ condition: 'rain', tempC: 4, source: 'manual' })
    await enqueue('u1', patch({ weather: { auto: true } }))
    expect((await withPendingEdits('u1', server)).weather).toBeNull()
  })
})

describe('matchesQueued', () => {
  const place = {
    latitude: 1,
    longitude: 2,
    placeName: 'Park',
    locality: null,
    region: null,
    country: null,
    address: null,
    googlePlaceId: null,
  }
  const sunny = { condition: 'clear', tempC: 20, isDay: true } as const
  const current = (over: Partial<EntryDetail> = {}): EntryDetail =>
    ({ ...detailJson('e1', 5), attachments: [], ...over }) as EntryDetail
  const weather = (source: 'manual' | 'google') => ({
    ...sunny,
    description: null,
    pressureMb: null,
    humidityPct: null,
    windKph: null,
    source,
  })

  it('needs every field the save sets to be on the server copy', () => {
    expect(matchesQueued({ baseRev: 3, bodyMd: 'from server' }, current())).toBe(true)
    expect(matchesQueued({ baseRev: 3, bodyMd: 'mine' }, current())).toBe(false)
    expect(matchesQueued({ starred: true }, current())).toBe(false)
    expect(matchesQueued({ somethingNew: 1 }, current())).toBe(false)
  })

  it('compares place, weather and removed media', () => {
    expect(matchesQueued({ location: place }, current({ location: place }))).toBe(true)
    expect(matchesQueued({ location: place }, current())).toBe(false)
    expect(matchesQueued({ location: null }, current({ location: place }))).toBe(false)
    expect(matchesQueued({ weather: sunny }, current({ weather: weather('manual') }))).toBe(true)
    expect(matchesQueued({ weather: sunny }, current({ weather: weather('google') }))).toBe(false)
    expect(
      matchesQueued({ weather: { auto: true } }, current({ weather: weather('google') })),
    ).toBe(true)
    expect(matchesQueued({ weather: null }, current({ weather: weather('manual') }))).toBe(false)
    const photo = {
      id: 'p1',
      position: 0,
      width: 1,
      height: 1,
      takenAt: null,
      latitude: null,
      longitude: null,
    }
    expect(matchesQueued({ removeMediaIds: ['p1'] }, current({ photos: [photo] }))).toBe(false)
    expect(matchesQueued({ removeMediaIds: ['p1'] }, current())).toBe(true)
  })
})

describe('isUnreachable', () => {
  it('is true for a failed fetch and gateway errors only', () => {
    expect(isUnreachable(new TypeError('Failed to fetch'))).toBe(true)
    expect(isUnreachable(new ApiError(503, null))).toBe(true)
    expect(isUnreachable(new ApiError(409, null))).toBe(false)
    expect(isUnreachable(new ApiError(500, null))).toBe(false)
    expect(isUnreachable(new Error('schema'))).toBe(false)
  })
})

const create = (id: string): OutboxItem => ({
  target: 'new',
  entryId: id,
  method: 'POST',
  path: '/entries',
  body: { id, journalId: 'j1', bodyMd: `entry ${id}`, timezone: 'UTC' },
  queuedAt: 1,
  draft: { ...draft, newId: id, baseRev: null, bodyMd: `entry ${id}` },
})

describe('flushOutbox', () => {
  const respond = (status: number, body: unknown) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(body), { status })),
    )

  it('sends the queued request and clears it on success', async () => {
    await enqueue('u1', patch({ bodyMd: 'mine' }))
    respond(200, detailJson('e1', 4))
    const qc = new QueryClient()
    await flushOutbox('u1', qc)
    expect(await loadOutbox('u1')).toEqual([])
    expect(qc.getQueryData<EntryDetail>(['entry', 'e1'])?.entry.rev).toBe(4)
    const call = vi.mocked(fetch).mock.calls[0]!
    expect(call[0]).toBe('/api/entries/e1')
    expect(JSON.parse(String((call[1] as RequestInit).body))).toMatchObject({ baseRev: 3 })
  })

  it('replays several entries written offline, oldest first, each once', async () => {
    for (const id of ['n1', 'n2', 'n3']) await enqueue('u1', create(id))
    const sent: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { id: string }
        sent.push(body.id)
        return new Response(JSON.stringify(detailJson(body.id, 1)), { status: 201 })
      }),
    )
    await flushOutbox('u1', new QueryClient())
    expect(sent).toEqual(['n1', 'n2', 'n3'])
    expect(await loadOutbox('u1')).toEqual([])
  })

  it('stops at the first unreachable save and keeps the rest in order', async () => {
    for (const id of ['n1', 'n2']) await enqueue('u1', create(id))
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await flushOutbox('u1', new QueryClient())
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
    expect((await loadOutbox('u1')).map((x) => x.entryId)).toEqual(['n1', 'n2'])
    expect(outboxState().pending).toBe(2)
  })

  it('does not send a save twice when another tab holds the replay lock', async () => {
    await enqueue('u1', patch({ bodyMd: 'mine' }))
    respond(200, detailJson('e1', 4))
    // A Web Locks stand-in where somebody else already has the lock.
    vi.stubGlobal('navigator', {
      locks: {
        request: async (_n: string, _o: unknown, cb: (l: unknown) => Promise<void>) => cb(null),
      },
    })
    await flushOutbox('u1', new QueryClient())
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
    expect(await loadOutbox('u1')).toHaveLength(1)
  })

  it('turns a refused save (conflict) back into a draft', async () => {
    await enqueue('u1', patch({ bodyMd: 'mine' }))
    respond(409, { error: 'conflict', current: detailJson('e1', 5) })
    await flushOutbox('u1', new QueryClient())
    expect(await loadOutbox('u1')).toEqual([])
    expect(loadDraft('u1', 'e1', ls)?.bodyMd).toBe('mine')
    expect(outboxState().failed).toBeGreaterThan(0)
  })

  it('takes a conflict that already holds this very save as done (its first answer was lost)', async () => {
    await enqueue('u1', patch({ bodyMd: 'mine', starred: true, tags: ['Walk'] }))
    const current = detailJson('e1', 4)
    respond(409, {
      error: 'conflict',
      current: {
        ...current,
        entry: { ...current.entry, bodyMd: 'mine', starred: true },
        tags: ['walk'],
      },
    })
    const qc = new QueryClient()
    const failedBefore = outboxState().failed
    await flushOutbox('u1', qc)
    expect(await loadOutbox('u1')).toEqual([])
    expect(loadDraft('u1', 'e1', ls)).toBeNull()
    expect(outboxState().failed).toBe(failedBefore)
    expect(qc.getQueryData<EntryDetail>(['entry', 'e1'])?.entry.rev).toBe(4)
  })

  it('does not overwrite a newer draft when restoring a refused save', async () => {
    ls.setItem('cairn:draft:u1:e1', JSON.stringify({ ...draft, v: 1, bodyMd: 'newer', savedAt: 9 }))
    await enqueue('u1', patch({ bodyMd: 'mine' }))
    respond(404, { error: 'not_found' })
    await flushOutbox('u1', new QueryClient())
    expect(loadDraft('u1', 'e1', ls)?.bodyMd).toBe('newer')
  })

  it('stops at a 401 and keeps the queue', async () => {
    await enqueue('u1', patch({ bodyMd: 'mine' }))
    respond(401, { error: 'unauthorized' })
    await flushOutbox('u1', new QueryClient())
    expect(await loadOutbox('u1')).toHaveLength(1)
  })
})

async function fetchEntryDetailFor(id: string) {
  const item = (await loadOutbox('u1')).find((x) => x.entryId === id)!
  return withPendingEdits('u1', pendingCreateDetail(item))
}

describe('editing an entry that has not been sent yet', () => {
  it('folds an edit into the waiting create instead of queuing a second request', async () => {
    await enqueue('u1', create('n1'))
    await enqueue(
      'u1',
      patch({ bodyMd: 'rewritten', starred: true, baseRev: 0, removeMediaIds: ['x'] }, 'n1'),
    )
    const items = await loadOutbox('u1')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ method: 'POST', path: '/entries' })
    expect(items[0]!.body).toMatchObject({ id: 'n1', bodyMd: 'rewritten', starred: true })
    expect(items[0]!.body).not.toHaveProperty('baseRev')
    expect(items[0]!.body).not.toHaveProperty('removeMediaIds')
  })

  it('shows the folded edit on the waiting entry', async () => {
    await enqueue('u1', create('n1'))
    await enqueue('u1', patch({ starred: true }, 'n1'))
    const base = (await fetchEntryDetailFor('n1')).entry
    expect(base.starred).toBe(true)
  })

  it('keeps the tags of a waiting create, and folds a later tag edit into it', async () => {
    await enqueue('u1', create('n1'))
    await enqueue('u1', patch({ tags: ['x', 'y'] }, 'n1'))
    expect((await fetchEntryDetailFor('n1')).tags).toEqual(['x', 'y'])
    expect((await loadOutbox('u1'))[0]!.body.tags).toEqual(['x', 'y'])
  })

  it('drops an `auto` weather request, which a create does anyway', async () => {
    await enqueue('u1', create('n1'))
    await enqueue('u1', patch({ weather: { auto: true } }, 'n1'))
    expect((await loadOutbox('u1'))[0]!.body).not.toHaveProperty('weather')
  })
})

describe('what waiting saves look like in the app', () => {
  const card = (id: string, createdAt: number) => ({
    id,
    journalId: 'j1',
    createdAt,
    timezone: 'UTC',
    starred: false,
    pinned: false,
    allDay: false,
    mood: null,
    title: `old ${id}`,
    excerpt: '',
    photoCount: 0,
    photos: [],
    placeName: null,
    weather: null,
  })
  const page = (items: ReturnType<typeof card>[], nextCursor: string | null = null) => ({
    items,
    nextCursor,
  })
  const ids = (p: unknown) => (p as { items: { id: string }[] }).items.map((i) => i.id)

  it('shows an entry written offline at the top of the list, and its edits on other cards', async () => {
    await enqueue('u1', { ...create('n1'), body: { ...create('n1').body, createdAt: 5_000 } })
    await enqueue('u1', patch({ bodyMd: 'Edited title\n\nmore', starred: true }, 'e1'))
    const out = (await withPendingCards('u1', '/entries', page([card('e1', 1_000)]))) as {
      items: { id: string; title: string; starred: boolean }[]
    }
    expect(out.items.map((i) => i.id)).toEqual(['n1', 'e1'])
    expect(out.items[1]).toMatchObject({ title: 'Edited title', starred: true })
    expect(out.items[0]!.title).toBe('entry n1')
  })

  it('respects the journal filter and leaves later pages alone', async () => {
    await enqueue('u1', create('n1'))
    expect(ids(await withPendingCards('u1', '/entries?journalId=other', page([])))).toEqual([])
    expect(ids(await withPendingCards('u1', '/entries?journalId=j1', page([])))).toEqual(['n1'])
    expect(ids(await withPendingCards('u1', '/entries?cursor=5_x', page([card('e9', 1)])))).toEqual(
      ['e9'],
    )
  })

  it('does not place a new entry on a first page that has older entries after it', async () => {
    await enqueue('u1', { ...create('n1'), body: { ...create('n1').body, createdAt: 10 } })
    const out = await withPendingCards('u1', '/entries', page([card('e1', 5_000)], '5000_e1'))
    expect(ids(out)).toEqual(['e1'])
  })

  it('opens an entry written offline, from the outbox', async () => {
    setActiveUser('u1')
    await enqueue('u1', create('n1'))
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const d = await fetchEntry('n1')
    expect(d.entry).toMatchObject({ id: 'n1', bodyMd: 'entry n1', rev: 0 })
    await expect(fetchEntry('not-queued')).rejects.toThrow()
    setActiveUser(null)
  })
})

describe('sendOrQueue', () => {
  const req = (draftNull = false) => ({
    method: 'PATCH' as const,
    path: '/entries/e1',
    body: { starred: true, baseRev: 3 },
    entryId: 'e1',
    target: 'e1',
    draft: draftNull ? null : { ...draft },
  })

  it('returns the server answer when it is reachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(detailJson('e1', 4)), { status: 200 })),
    )
    expect((await sendOrQueue('u1', req()))?.entry.rev).toBe(4)
    expect(await loadOutbox('u1')).toEqual([])
  })

  it('queues a quick change (star) offline with nothing to restore', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    expect(await sendOrQueue('u1', req(true))).toBeNull()
    const [item] = await loadOutbox('u1')
    expect(item).toMatchObject({ method: 'PATCH', draft: null })
  })

  it('throws what the server refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":"conflict"}', { status: 409 })),
    )
    await expect(sendOrQueue('u1', req())).rejects.toBeInstanceOf(ApiError)
    expect(await loadOutbox('u1')).toEqual([])
  })

  it('a refused quick change is reported with a way to review it, and restores no draft', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await sendOrQueue('u1', req(true))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":"not_found"}', { status: 404 })),
    )
    await flushOutbox('u1', new QueryClient())
    expect(outboxState().review).toBe('/entry/e1')
    expect(loadDraft('u1', 'e1', ls)).toBeNull()
  })

  it('a refused edit points back at the restored draft', async () => {
    await enqueue('u1', patch({ bodyMd: 'mine' }))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":"not_found"}', { status: 404 })),
    )
    await flushOutbox('u1', new QueryClient())
    expect(outboxState().review).toBe('/entry/e1/edit')
  })
})
