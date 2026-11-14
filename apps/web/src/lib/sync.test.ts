import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncChanges, SyncEntry } from '@cairn/shared'
import { deleteLocalDb, localDb } from './localDb.ts'
import {
  offlineSelection,
  setJournalOffline,
  setSyncAll,
  syncKeptPhotos,
  syncNow,
  syncState,
} from './sync.ts'

const U = 'u1'

const entry = (id: string, journalId: string, rev = 1): SyncEntry => ({
  entry: {
    id,
    journalId,
    bodyMd: `body ${id}`,
    createdAt: 1000,
    modifiedAt: 1000,
    timezone: 'UTC',
    starred: false,
    pinned: false,
    allDay: false,
    mood: null,
    moodSuggested: null,
    creationDevice: null,
    source: 'native',
    rev,
  },
  location: null,
  weather: null,
  tags: [],
})
const journal = (id: string) => ({
  id,
  name: id,
  color: null,
  icon: null,
  description: null,
  archivedAt: null,
  sortOrder: 0,
  createdAt: 1,
  rev: 1,
})
const photo = (id: string, entryId: string) => ({
  id,
  entryId,
  position: 0,
  width: 1,
  height: 1,
  takenAt: null,
  latitude: null,
  longitude: null,
  rev: 1,
})
const page = (p: Partial<SyncChanges> = {}): SyncChanges => ({
  cursor: 10,
  hasMore: false,
  reset: false,
  journals: [],
  deletedJournalIds: [],
  entries: [],
  deletedEntryIds: [],
  photos: [],
  deletedPhotoIds: [],
  attachments: [],
  deletedAttachmentIds: [],
  ...p,
})
const attachment = (id: string, entryId: string) => ({
  id,
  entryId,
  kind: 'pdf' as const,
  position: 0,
  filename: `${id}.pdf`,
  mime: 'application/pdf',
  bytes: 1,
  rev: 1,
})

/** Answers each feed request from `script`, remembering the query it was asked. */
function feed(script: (q: URLSearchParams) => SyncChanges) {
  const asked: URLSearchParams[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const q = new URL(url, 'http://x').searchParams
      asked.push(q)
      return new Response(JSON.stringify(script(q)), { status: 200 })
    }),
  )
  return asked
}

beforeEach(() => {
  vi.stubGlobal('navigator', {}) // no Web Locks: this tab runs it
})
afterEach(async () => {
  vi.unstubAllGlobals()
  await deleteLocalDb(U)
})

describe('syncNow', () => {
  it('does nothing while no journal is kept offline', async () => {
    const asked = feed(() => page())
    await syncNow(U)
    expect(asked).toHaveLength(0)
  })

  it('downloads a journal from the start, then keeps only it current', async () => {
    const asked = feed((q) =>
      q.get('since') === '0'
        ? page({
            cursor: 7,
            journals: [journal('j1'), journal('j2')],
            entries: [entry('e1', 'j1')],
            photos: [photo('p1', 'e1')],
          })
        : page({ cursor: 9 }),
    )
    await setJournalOffline(U, 'j1', true)
    await syncNow(U)
    expect(asked[0]!.get('since')).toBe('0')
    expect(asked[0]!.get('journalIds')).toBe('j1')
    const db = localDb(U)
    expect((await db.entries.toArray()).map((e) => e.id)).toEqual(['e1'])
    expect(await db.photos.count()).toBe(1)
    expect((await db.journals.toArray()).map((j) => j.id).sort()).toEqual(['j1', 'j2'])
    expect(await offlineSelection(U)).toMatchObject({ ready: ['j1'], waiting: [] })
    expect((await db.meta.get('cursor'))?.value).toBe(7)

    await syncNow(U)
    expect(asked[1]!.get('since')).toBe('7')
    expect(asked[1]!.get('journalIds')).toBe('j1')
    expect((await db.meta.get('cursor'))?.value).toBe(9)
  })

  it('follows pages until the feed says it is done', async () => {
    const asked = feed((q) =>
      q.get('since') === '0'
        ? page({ cursor: 3, hasMore: true, entries: [entry('e1', 'j1')] })
        : page({ cursor: 6, entries: [entry('e2', 'j1')] }),
    )
    await setJournalOffline(U, 'j1', true)
    await syncNow(U)
    expect(asked.map((q) => q.get('since'))).toEqual(['0', '3'])
    expect(await localDb(U).entries.count()).toBe(2)
  })

  it('applies deletes, and a deleted entry takes its photos with it', async () => {
    feed((q) =>
      q.get('since') === '0'
        ? page({
            cursor: 5,
            entries: [entry('e1', 'j1'), entry('e2', 'j1')],
            photos: [photo('p1', 'e1'), photo('p2', 'e2')],
          })
        : page({ cursor: 8, deletedEntryIds: ['e1'], deletedPhotoIds: ['p2'] }),
    )
    await setJournalOffline(U, 'j1', true)
    await syncNow(U)
    await syncNow(U)
    const db = localDb(U)
    expect((await db.entries.toArray()).map((e) => e.id)).toEqual(['e2'])
    expect(await db.photos.count()).toBe(0)
  })

  it('keeps attachment records (never their files), dropped with their entry', async () => {
    feed((q) =>
      q.get('since') === '0'
        ? page({
            cursor: 5,
            entries: [entry('e1', 'j1'), entry('e2', 'j1')],
            attachments: [attachment('a1', 'e1'), attachment('a2', 'e2'), attachment('a3', 'e2')],
          })
        : page({ cursor: 8, deletedEntryIds: ['e1'], deletedAttachmentIds: ['a3'] }),
    )
    await setJournalOffline(U, 'j1', true)
    await syncNow(U)
    const db = localDb(U)
    expect(await db.attachments.count()).toBe(3)
    await syncNow(U)
    expect((await db.attachments.toArray()).map((a) => a.id)).toEqual(['a2'])
  })

  it('a deleted journal leaves the offline set and loses its entries', async () => {
    feed((q) =>
      q.get('since') === '0'
        ? page({ cursor: 5, journals: [journal('j1')], entries: [entry('e1', 'j1')] })
        : page({ cursor: 8, deletedJournalIds: ['j1'], deletedEntryIds: ['e1'] }),
    )
    await setJournalOffline(U, 'j1', true)
    await syncNow(U)
    await syncNow(U)
    expect(await localDb(U).entries.count()).toBe(0)
    expect(await offlineSelection(U)).toMatchObject({ ready: [], waiting: [] })
  })

  it('adding a second journal downloads only it and leaves the cursor alone', async () => {
    const asked = feed((q) => {
      if (q.get('since') === '0' && q.get('journalIds') === 'j1')
        return page({ cursor: 5, entries: [entry('e1', 'j1')] })
      if (q.get('since') === '0') return page({ cursor: 6, entries: [entry('e2', 'j2')] })
      return page({ cursor: 9 })
    })
    await setJournalOffline(U, 'j1', true)
    await syncNow(U)
    await setJournalOffline(U, 'j2', true)
    await syncNow(U)
    // The incremental pull for j1 runs first, then j2 is fetched from the start on its own.
    expect(asked.slice(1).map((q) => [q.get('since'), q.get('journalIds')])).toEqual([
      ['5', 'j1'],
      ['0', 'j2'],
    ])
    expect((await offlineSelection(U)).ready.sort()).toEqual(['j1', 'j2'])
    expect((await localDb(U).meta.get('cursor'))?.value).toBe(9)
    expect(await localDb(U).entries.count()).toBe(2)
  })

  it('switching a journal off removes its copy', async () => {
    feed(() => page({ cursor: 5, entries: [entry('e1', 'j1'), entry('e2', 'j2')] }))
    await setJournalOffline(U, 'j1', true)
    await syncNow(U)
    await setJournalOffline(U, 'j1', false)
    expect(await offlineSelection(U)).toMatchObject({ ready: [], waiting: [] })
    expect((await localDb(U).entries.toArray()).map((e) => e.journalId)).not.toContain('j1')
    expect(await localDb(U).meta.get('cursor')).toBeUndefined()
  })

  it('starts over when the server says its history is behind ours', async () => {
    let resets = 0
    const asked = feed((q) => {
      if (q.get('since') === '5') {
        resets++
        return page({ reset: true, hasMore: true, cursor: 0 })
      }
      return q.get('since') === '0'
        ? page({ cursor: resets ? 2 : 5, entries: [entry(resets ? 'fresh' : 'old', 'j1')] })
        : page({ cursor: 5 })
    })
    await setJournalOffline(U, 'j1', true)
    await syncNow(U)
    await syncNow(U)
    expect(resets).toBe(1)
    expect((await localDb(U).entries.toArray()).map((e) => e.id)).toEqual(['fresh'])
    expect(await offlineSelection(U)).toMatchObject({ ready: ['j1'] })
    expect(asked.length).toBeGreaterThan(2)
  })

  it('leaves the copy alone and reports it when the server is unreachable', async () => {
    feed(() => page({ cursor: 5, entries: [entry('e1', 'j1')] }))
    await setJournalOffline(U, 'j1', true)
    await syncNow(U)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await syncNow(U)
    expect(syncState().error).toBe('offline')
    expect(await localDb(U).entries.count()).toBe(1)
    expect(syncState().running).toBe(false)
  })
})

describe('syncKeptPhotos', () => {
  function fakeCaches() {
    const store = new Map<string, Response>()
    const cache = {
      keys: async () => [...store.keys()].map((u) => new Request(`http://x${u}`)),
      put: async (u: string, r: Response) => void store.set(u, r),
      delete: async (r: Request) => store.delete(new URL(r.url).pathname),
    }
    vi.stubGlobal('caches', { open: async () => cache })
    return store
  }
  const withPhotos = async (...ids: string[]) =>
    localDb(U).photos.bulkPut(ids.map((id) => photo(id, 'e1')))

  it('downloads thumb and display for each held photo, once', async () => {
    const store = fakeCaches()
    const fetched: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        fetched.push(url)
        return new Response('img', { status: 200 })
      }),
    )
    await withPhotos('p1', 'p2')
    expect(await syncKeptPhotos(U)).toBe(true)
    expect([...store.keys()].sort()).toEqual([
      '/api/photos/p1/display',
      '/api/photos/p1/thumb',
      '/api/photos/p2/display',
      '/api/photos/p2/thumb',
    ])
    await syncKeptPhotos(U)
    expect(fetched).toHaveLength(4) // the second pass found everything already there
  })

  it('drops files for photos no longer held', async () => {
    const store = fakeCaches()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('img', { status: 200 })),
    )
    await withPhotos('p1', 'p2')
    await syncKeptPhotos(U)
    await localDb(U).photos.delete('p2')
    await syncKeptPhotos(U)
    expect([...store.keys()].every((k) => k.includes('/p1/'))).toBe(true)
  })

  it('reports an unreachable server and keeps what it has', async () => {
    const store = fakeCaches()
    await withPhotos('p1')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    expect(await syncKeptPhotos(U)).toBe(false)
    expect(store.size).toBe(0)
  })
})

describe('keep all journals', () => {
  const full = (id: string, archived = false) => ({
    ...journal(id),
    archivedAt: archived ? 5 : null,
    entryCount: 0,
  })
  /** Serves the journal list and a feed that has one entry per requested journal. */
  function server(journals: () => ReturnType<typeof full>[], opts: { listDown?: boolean } = {}) {
    const asked: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = new URL(url, 'http://x')
        if (u.pathname === '/api/journals') {
          if (opts.listDown) throw new TypeError('Failed to fetch')
          return new Response(JSON.stringify(journals()), { status: 200 })
        }
        const ids = (u.searchParams.get('journalIds') ?? '').split(',').filter(Boolean)
        asked.push(`${u.searchParams.get('since')}:${ids.join('+')}`)
        const entries =
          u.searchParams.get('since') === '0' ? ids.map((j) => entry(`e-${j}`, j)) : []
        return new Response(JSON.stringify(page({ cursor: 10, entries })), { status: 200 })
      }),
    )
    return asked
  }

  it('keeps every active journal and skips archived ones', async () => {
    server(() => [full('a'), full('b', true), full('c')])
    await setSyncAll(U, true)
    await syncNow(U)
    const sel = await offlineSelection(U)
    expect(sel.syncAll).toBe(true)
    expect(sel.ready.sort()).toEqual(['a', 'c'])
    expect((await localDb(U).entries.toArray()).map((e) => e.journalId).sort()).toEqual(['a', 'c'])
  })

  it('picks up a journal created later, and leaves one archived later alone', async () => {
    let list = [full('a'), full('b')]
    server(() => list)
    await setSyncAll(U, true)
    await syncNow(U)
    list = [full('a'), full('b', true), full('d')]
    await syncNow(U)
    const sel = await offlineSelection(U)
    expect(sel.ready.sort()).toEqual(['a', 'b', 'd'])
  })

  it('turning it off keeps what is already kept', async () => {
    server(() => [full('a')])
    await setSyncAll(U, true)
    await syncNow(U)
    await setSyncAll(U, false)
    expect(await offlineSelection(U)).toMatchObject({ syncAll: false, ready: ['a'] })
  })

  it('still pulls the journals it holds when the journal list is unreachable', async () => {
    server(() => [full('a')])
    await setSyncAll(U, true)
    await syncNow(U)
    const asked = server(() => [], { listDown: true })
    await syncNow(U)
    expect(asked).toEqual(['10:a'])
    expect(syncState().error).toBeNull()
  })
})
