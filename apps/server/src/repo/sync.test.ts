import { beforeEach, describe, expect, it } from 'vitest'
import { attachmentMarkdown, photoMarkdown } from '@cairn/shared'
import { addUser, memoryDb } from '../test-helpers.ts'
import { createRepos } from './index.ts'
import type { SyncPage } from './sync.ts'

let db: ReturnType<typeof memoryDb>['db']
let a: ReturnType<typeof createRepos>
let b: ReturnType<typeof createRepos>

beforeEach(async () => {
  db = memoryDb().db
  a = createRepos(db, (await addUser(db, 'a')).id)
  b = createRepos(db, (await addUser(db, 'b')).id)
})

const photoInput = (id: string) => ({
  id,
  originalPath: `photos/u/originals/${id}.jpg`,
  displayPath: `photos/u/display/${id}.webp`,
  thumbPath: `photos/u/thumb/${id}.webp`,
  mime: 'image/jpeg',
  width: 10,
  height: 10,
  bytes: 1,
  sha256: id,
  takenAt: null,
  latitude: null,
  longitude: null,
})

const gps = {
  latitude: 1,
  longitude: 2,
  placeName: 'Here',
  locality: null,
  region: null,
  country: null,
  address: null,
  googlePlaceId: null,
}
const sunny = {
  condition: 'clear',
  tempC: 20,
  feelsLikeC: null,
  isDay: true,
  description: null,
  pressureMb: null,
  humidityPct: null,
  windKph: null,
  windBearing: null,
  visibilityKm: null,
  sunrise: null,
  sunset: null,
  source: 'google',
  sourceCode: 'CLEAR',
  fetchedAt: null,
  raw: null,
} as const

/** Follows the cursor to the end, like the client does. */
function drain(
  repo: typeof a,
  opts: { since?: number; limit?: number; journalIds?: string[] } = {},
) {
  const pages: SyncPage[] = []
  let since = opts.since ?? 0
  for (;;) {
    const p = repo.sync.changes({ since, limit: opts.limit ?? 200, journalIds: opts.journalIds })
    pages.push(p)
    if (!p.hasMore) return pages
    since = p.cursor
    if (pages.length > 100) throw new Error('feed did not end')
  }
}
const ids = (pages: SyncPage[], pick: (p: SyncPage) => { id: string }[]) =>
  pages.flatMap(pick).map((x) => x.id)

describe('sync feed', () => {
  it('sends journals, entries (with place, weather, tags) and photos from the start', () => {
    const j = a.journals.create({ name: 'Main' }).id
    a.photos.add(photoInput('p1'))
    const e = a.entries.create({
      journalId: j,
      bodyMd: `hi ${photoMarkdown('p1')}`,
      timezone: 'UTC',
      location: gps,
      weather: { condition: 'clear', tempC: 5, isDay: true },
    }).id
    const [page] = drain(a)
    expect(page!.journals.map((x) => x.id)).toEqual([j])
    expect(page!.entries).toHaveLength(1)
    expect(page!.entries[0]!.entry.id).toBe(e)
    expect(page!.entries[0]!.location?.placeName).toBe('Here')
    expect(page!.entries[0]!.weather?.condition).toBe('clear')
    expect(page!.photos.map((p) => [p.id, p.entryId])).toEqual([['p1', e]])
  })

  it('pages across tables without skipping or repeating anything', () => {
    const j = a.journals.create({ name: 'Main' }).id
    const made: string[] = []
    for (let i = 0; i < 7; i++) {
      made.push(a.entries.create({ journalId: j, bodyMd: `e${i}`, timezone: 'UTC' }).id)
    }
    for (const n of ['p1', 'p2', 'p3']) a.photos.add(photoInput(n))
    a.entries.update(made[0]!, {
      bodyMd: `x ${photoMarkdown('p1')} ${photoMarkdown('p2')} ${photoMarkdown('p3')}`,
    })
    const pages = drain(a, { limit: 3 })
    expect(pages.length).toBeGreaterThan(2)
    expect(pages.at(-1)!.hasMore).toBe(false)
    const got = ids(pages, (p) => p.entries.map((x) => x.entry))
    expect([...new Set(got)].sort()).toEqual([...made].sort())
    expect(got.length).toBe(new Set(got).size)
    expect(ids(pages, (p) => p.photos).sort()).toEqual(['p1', 'p2', 'p3'])
    // Cursors only move forward.
    const cursors = pages.map((p) => p.cursor)
    expect(cursors).toEqual([...cursors].sort((x, y) => x - y))
  })

  it('then sends only what changed, with deletes as tombstones', () => {
    const j = a.journals.create({ name: 'Main' }).id
    const e1 = a.entries.create({ journalId: j, bodyMd: 'one', timezone: 'UTC' }).id
    const e2 = a.entries.create({ journalId: j, bodyMd: 'two', timezone: 'UTC' }).id
    const cursor = drain(a).at(-1)!.cursor

    expect(drain(a, { since: cursor })[0]!.entries).toEqual([])

    a.entries.update(e1, { bodyMd: 'one edited' })
    a.entries.softDelete(e2)
    const [p] = drain(a, { since: cursor })
    expect(p!.entries.map((x) => x.entry.bodyMd)).toEqual(['one edited'])
    expect(p!.deletedEntryIds).toEqual([e2])
  })

  it('reports a deleted journal and its entries', () => {
    const j = a.journals.create({ name: 'Gone' }).id
    const e = a.entries.create({ journalId: j, bodyMd: 'x', timezone: 'UTC' }).id
    const cursor = drain(a).at(-1)!.cursor
    a.journals.softDelete(j)
    const [p] = drain(a, { since: cursor })
    expect(p!.deletedJournalIds).toEqual([j])
    expect(p!.deletedEntryIds).toEqual([e])
  })

  it('sends a restored entry and its photos again, and nothing for a purge', () => {
    const j = a.journals.create({ name: 'Main' }).id
    a.photos.add(photoInput('p1'))
    const e = a.entries.create({ journalId: j, bodyMd: photoMarkdown('p1'), timezone: 'UTC' }).id
    a.entries.softDelete(e)
    const cursor = drain(a).at(-1)!.cursor

    a.trash.restoreEntry(e)
    const [p] = drain(a, { since: cursor })
    expect(p!.entries.map((x) => x.entry.id)).toEqual([e])
    expect(p!.photos.map((x) => x.id)).toEqual(['p1'])

    a.entries.softDelete(e)
    const deleted = drain(a).at(-1)!.cursor
    a.trash.purgeEntry(e)
    const [q] = drain(a, { since: deleted })
    expect([q!.entries, q!.deletedEntryIds, q!.photos]).toEqual([[], [], []])
  })

  it('sends a restored journal with its entries', () => {
    const j = a.journals.create({ name: 'Back' }).id
    const e = a.entries.create({ journalId: j, bodyMd: 'x', timezone: 'UTC' }).id
    a.journals.softDelete(j)
    const cursor = drain(a).at(-1)!.cursor
    a.trash.restoreJournal(j)
    const [p] = drain(a, { since: cursor })
    expect(p!.journals.map((x) => x.id)).toEqual([j])
    expect(p!.entries.map((x) => x.entry.id)).toEqual([e])
  })

  it('carries a background weather fetch without bumping the entry rev', () => {
    const j = a.journals.create({ name: 'Main' }).id
    const e = a.entries.create({ journalId: j, bodyMd: 'x', timezone: 'UTC', location: gps }).id
    const before = drain(a).at(-1)!
    expect(before.entries[0]!.weather).toBeNull()
    const rev = before.entries[0]!.entry.rev

    expect(a.entries.setFetchedWeather(e, { ...sunny })).toBe('written')

    const [p] = drain(a, { since: before.cursor })
    expect(p!.entries).toHaveLength(1)
    expect(p!.entries[0]!.weather?.condition).toBe('clear')
    expect(p!.entries[0]!.entry.rev).toBe(rev)
    expect(a.entries.get(e)!.rev).toBe(rev)
  })

  it('reports a removed photo as deleted', () => {
    const j = a.journals.create({ name: 'Main' }).id
    a.photos.add(photoInput('p1'))
    a.entries.create({ journalId: j, bodyMd: photoMarkdown('p1'), timezone: 'UTC' })
    const cursor = drain(a).at(-1)!.cursor
    a.photos.remove('p1')
    const [p] = drain(a, { since: cursor })
    expect(p!.deletedPhotoIds).toEqual(['p1'])
  })

  it('sends attachments as their own records, and a removed one as deleted', () => {
    const j = a.journals.create({ name: 'Main' }).id
    a.attachments.add({
      id: 'f1',
      kind: 'pdf',
      path: 'attachments/u/f1.pdf',
      mime: 'application/pdf',
      bytes: 3,
      sha256: 'f1',
      filename: 'f1.pdf',
    })
    const e = a.entries.create({
      journalId: j,
      bodyMd: attachmentMarkdown('f1', 'f1.pdf'),
      timezone: 'UTC',
    })
    const pages = drain(a)
    expect(pages.flatMap((p) => p.attachments).map((x) => [x.id, x.entryId])).toEqual([
      ['f1', e.id],
    ])
    expect(drain(b).flatMap((p) => p.attachments)).toEqual([])
    a.attachments.remove('f1')
    const [p] = drain(a, { since: pages.at(-1)!.cursor })
    expect(p!.deletedAttachmentIds).toEqual(['f1'])
  })

  describe('journalIds', () => {
    it('limits the first sync to those journals but always sends the journals', () => {
      const j1 = a.journals.create({ name: 'Offline' }).id
      const j2 = a.journals.create({ name: 'Online only' }).id
      const e1 = a.entries.create({ journalId: j1, bodyMd: 'in', timezone: 'UTC' }).id
      a.entries.create({ journalId: j2, bodyMd: 'out', timezone: 'UTC' })
      const [p] = drain(a, { journalIds: [j1] })
      expect(p!.journals.map((j) => j.id).sort()).toEqual([j1, j2].sort())
      expect(p!.entries.map((x) => x.entry.id)).toEqual([e1])
      expect(p!.deletedEntryIds).toEqual([])
    })

    it('tells the client to drop an entry that moved out of a synced journal', () => {
      const j1 = a.journals.create({ name: 'Offline' }).id
      const j2 = a.journals.create({ name: 'Online only' }).id
      const e = a.entries.create({ journalId: j1, bodyMd: 'x', timezone: 'UTC' }).id
      const cursor = drain(a, { journalIds: [j1] }).at(-1)!.cursor
      a.entries.update(e, { journalId: j2 })
      const [p] = drain(a, { since: cursor, journalIds: [j1] })
      expect(p!.entries).toEqual([])
      expect(p!.deletedEntryIds).toEqual([e])
    })
  })

  it('asks for a reset when the cursor is ahead of the server', () => {
    a.journals.create({ name: 'Main' })
    const p = a.sync.changes({ since: 9999, limit: 10 })
    expect(p.reset).toBe(true)
    expect(p.entries).toEqual([])
  })

  it("never includes another user's data", () => {
    const j = a.journals.create({ name: 'Private' }).id
    a.photos.add(photoInput('p1'))
    a.entries.create({ journalId: j, bodyMd: photoMarkdown('p1'), timezone: 'UTC', location: gps })
    const [p] = drain(b)
    expect(p).toMatchObject({ journals: [], entries: [], photos: [], deletedEntryIds: [] })
    // Even when asking for A's journal by id.
    const [q] = drain(b, { journalIds: [j] })
    expect(q!.entries).toEqual([])
  })
})
