import { beforeAll, describe, expect, it } from 'vitest'
import { addUser, memoryDb } from '../test-helpers.ts'
import { JournalNotFoundError, RevConflictError } from './entries.ts'
import { createRepos } from './index.ts'
import { TagNotFoundError } from './tags.ts'

// SPEC 4d: user A must not be able to read, edit or delete user B's data. Search and drafts get
// the same treatment when those features exist (Phase 3).
let db: ReturnType<typeof memoryDb>['db']
let a: ReturnType<typeof createRepos>
let b: ReturnType<typeof createRepos>
let aJournal: string
let aEntry: string

beforeAll(async () => {
  db = memoryDb().db
  const [ua, ub] = [await addUser(db, 'a'), await addUser(db, 'b')]
  a = createRepos(db, ua.id)
  b = createRepos(db, ub.id)
  aJournal = a.journals.create({ name: 'A private' }).id
  aEntry = a.entries.create({ journalId: aJournal, bodyMd: 'secret', timezone: 'UTC' }).id
})

describe('user scoping', () => {
  it("B cannot read A's journals or entries", () => {
    expect(b.journals.get(aJournal)).toBeUndefined()
    expect(b.journals.list({ includeArchived: true })).toEqual([])
    expect(b.entries.get(aEntry)).toBeUndefined()
    expect(b.entries.timeline({ includeArchived: true }).items).toEqual([])
    expect(b.entries.timeline({ journalId: aJournal }).items).toEqual([])
  })

  it("B cannot edit or delete A's data", () => {
    expect(b.journals.update(aJournal, { name: 'pwned' })).toBeUndefined()
    expect(b.journals.softDelete(aJournal)).toBe(false)
    expect(b.entries.update(aEntry, { bodyMd: 'pwned' })).toBeUndefined()
    expect(b.entries.softDelete(aEntry)).toBe(false)

    expect(a.journals.get(aJournal)?.name).toBe('A private')
    expect(a.entries.get(aEntry)?.bodyMd).toBe('secret')
  })

  it("B cannot put an entry in A's journal, or move one there", () => {
    expect(() => b.entries.create({ journalId: aJournal, timezone: 'UTC' })).toThrow(
      JournalNotFoundError,
    )
    const own = b.journals.create({ name: 'B' }).id
    const mine = b.entries.create({ journalId: own, timezone: 'UTC' })
    expect(() => b.entries.update(mine.id, { journalId: aJournal })).toThrow(JournalNotFoundError)
  })
})

describe('attachments', () => {
  it("B cannot read, delete or attach A's attachments", () => {
    a.attachments.add({
      id: 'att-a',
      kind: 'pdf',
      path: 'attachments/a/x.pdf',
      mime: 'application/pdf',
      bytes: 1,
      sha256: 'x',
      filename: 'x.pdf',
    })
    expect(b.attachments.get('att-a')).toBeUndefined()
    expect(b.attachments.remove('att-a')).toBe(false)
    const bJournal = b.journals.create({ name: 'B' }).id
    const bEntry = b.entries.create({
      journalId: bJournal,
      bodyMd: '![x](attachment:att-a)',
      timezone: 'UTC',
    })
    expect(b.entries.detail(bEntry.id)?.attachments).toEqual([])
    expect(a.attachments.get('att-a')?.entryId).toBeNull()
  })
})

describe('imported data (location, weather, tags, photos)', () => {
  let importedEntry: string
  let importedPhoto: string
  beforeAll(() => {
    const j = a.journals.create({ name: 'imported' }).id
    expect(
      a.imports.importEntry({
        sourceId: 'DAYONE-1',
        journalId: j,
        bodyMd: 'secret trip',
        createdAt: 1,
        modifiedAt: 1,
        timezone: 'UTC',
        starred: false,
        pinned: false,
        allDay: false,
        creationDevice: null,
        sourceRaw: '{}',
        tags: ['private'],
        location: { latitude: 1, longitude: 2, placeName: 'secret place' },
        weather: { condition: 'clear', source: 'dayone' },
        photos: [
          {
            id: 'photo-a',
            position: 0,
            originalPath: 'photos/a/originals/x.jpg',
            mime: 'image/jpeg',
            bytes: 1,
            sha256: 'x',
          },
        ],
      }),
    ).toBe('imported')
    importedEntry = a.entries.timeline({ journalId: j }).items[0]!.id
    importedPhoto = 'photo-a'
  })

  it("B cannot read A's photos, details or imported entries", () => {
    expect(a.entries.detail(importedEntry)?.photos).toHaveLength(1)
    expect(a.photos.get(importedPhoto)).toBeDefined()

    expect(b.photos.get(importedPhoto)).toBeUndefined()
    expect(b.photos.listForEntry(importedEntry)).toEqual([])
    expect(b.entries.detail(importedEntry)).toBeUndefined()
    expect(b.entries.get(importedEntry)).toBeUndefined()
  })

  it("B cannot import into A's journal, and A's source ids don't block B's", () => {
    const entry = {
      sourceId: 'DAYONE-1',
      journalId: aJournal,
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
      photos: [],
    }
    // Same source id as A's entry, but A's journal: skipped only if it were B's own entry.
    expect(() => b.imports.importEntry(entry)).toThrow('journal not found')
    const own = b.journals.create({ name: 'b-import' }).id
    expect(b.imports.importEntry({ ...entry, journalId: own })).toBe('imported')
    expect(b.imports.importEntry({ ...entry, journalId: own })).toBe('skipped')
  })
})

describe('sync columns', () => {
  it('stamps increasing per-user revs and hides tombstones', () => {
    const j = a.journals.create({ name: 'tmp' })
    const e = a.entries.create({ journalId: j.id, timezone: 'UTC' })
    const e2 = a.entries.update(e.id, { bodyMd: 'x' })!
    expect(e2.rev).toBeGreaterThan(e.rev)

    expect(a.entries.softDelete(e.id)).toBe(true)
    expect(a.entries.get(e.id)).toBeUndefined()
    expect(a.entries.timeline({ journalId: j.id }).items).toEqual([])
  })

  it('accepts client-supplied ids and refuses a stale base_rev', () => {
    const id = '0194a3c2-0000-7000-8000-000000000001'
    const e = a.entries.create({ id, journalId: aJournal, timezone: 'UTC' })
    expect(e.id).toBe(id)
    a.entries.update(id, { bodyMd: 'newer' })
    expect(() => a.entries.update(id, { bodyMd: 'stale' }, { baseRev: e.rev })).toThrow(
      RevConflictError,
    )
    expect(a.entries.get(id)?.bodyMd).toBe('newer')
  })

  it('leaves mood null unless one is given', () => {
    expect(a.entries.create({ journalId: aJournal, timezone: 'UTC' }).moodKey).toBeNull()
  })
})

describe('tags', () => {
  it("B cannot list A's tags or filter by them, and A's tag names don't block B's", () => {
    expect(a.tags.list().map((t) => t.name)).toContain('private')
    expect(b.tags.list()).toEqual([])
    expect(b.entries.timeline({ tag: 'private', includeArchived: true }).items).toEqual([])
    const bj = b.journals.create({ name: 'B' }).id
    const e = b.entries.create({ journalId: bj, timezone: 'UTC', tags: ['Private'] })
    expect(b.entries.detail(e.id)!.tags).toEqual(['Private'])
    b.entries.softDelete(e.id) // the search test below expects B to own nothing searchable
    expect(a.entries.detail(aEntry)!.tags).toEqual([])
    expect(a.tags.list().find((t) => t.name === 'private')?.count).toBe(1)
  })

  it("B cannot rename, merge or delete A's tags", () => {
    a.entries.update(aEntry, { tags: ['a-only'] })
    expect(() => b.tags.rename('a-only', 'mine')).toThrow(TagNotFoundError)
    expect(() => b.tags.remove('a-only')).toThrow(TagNotFoundError)
    const bj = b.journals.create({ name: 'B2' }).id
    const e = b.entries.create({ journalId: bj, timezone: 'UTC', tags: ['mine'] })
    expect(() => b.tags.merge('a-only', 'mine')).toThrow(TagNotFoundError)
    expect(() => b.tags.merge('mine', 'a-only')).toThrow(TagNotFoundError)
    b.entries.softDelete(e.id)
    expect(a.entries.detail(aEntry)!.tags).toEqual(['a-only'])
    expect(a.search.search({ q: 'a-only' }).items.length).toBeGreaterThan(0)
    a.entries.update(aEntry, { tags: [] }) // leave A's entry as the other tests expect
  })

  it("B cannot change tags on A's entry", () => {
    expect(b.entries.update(aEntry, { tags: ['mine-now'] })).toBeUndefined()
    expect(a.tags.list().map((t) => t.name)).not.toContain('mine-now')
  })
})

describe('search', () => {
  it("B cannot find A's text, places or tags, whatever the filters", () => {
    // 'secret' is A's entry text, 'secret place' and 'private' come from A's imported entry.
    for (const q of ['secret', 'place', 'private', 'trip']) {
      expect(a.search.search({ q, includeArchived: true }).items.length).toBeGreaterThan(0)
      for (const opts of [
        {},
        { includeArchived: true },
        { journalId: aJournal },
        { sort: 'relevance' as const },
      ]) {
        expect(b.search.search({ q, ...opts }).items).toEqual([])
      }
    }
  })
})

describe('export', () => {
  it("B's export has none of A's journals, entries or photos", () => {
    const exported = (r: typeof a) =>
      r.export.journals().map((journal) => ({
        journal,
        entries: r.export.entries(r.export.entryIds(journal.id), r.export.media()),
      }))
    const mine = exported(a)
    expect(mine.length).toBeGreaterThan(0)
    expect(mine.flatMap((j) => j.entries).length).toBeGreaterThan(0)
    const aIds = new Set(mine.flatMap((j) => [j.journal.id, ...j.entries.map((e) => e.entry.id)]))
    for (const j of exported(b)) {
      expect(aIds.has(j.journal.id)).toBe(false)
      for (const e of j.entries) expect(aIds.has(e.entry.id)).toBe(false)
    }
    // Asking for A's journal or entries by id gets B nothing.
    const aJournal = mine[0]!.journal.id
    expect(b.export.journals(aJournal)).toEqual([])
    expect(b.export.entryIds(aJournal)).toEqual([])
    expect(b.export.entries([...aIds], b.export.media())).toEqual([])
    expect(b.export.media(aJournal).photos.size + b.export.media(aJournal).attachments.size).toBe(0)
  })
})

describe('sync feed', () => {
  it("B's feed has none of A's data, even when it names A's journal", () => {
    const mine = a.sync.changes({ since: 0, limit: 500 })
    expect(mine.entries.length).toBeGreaterThan(0)
    const aIds = new Set([
      ...mine.journals.map((j) => j.id),
      ...mine.entries.map((e) => e.entry.id),
      ...mine.photos.map((p) => p.id),
    ])
    for (const opts of [{}, { journalIds: [aJournal] }]) {
      const theirs = b.sync.changes({ since: 0, limit: 500, ...opts })
      const ids = [
        ...theirs.journals.map((j) => j.id),
        ...theirs.entries.map((e) => e.entry.id),
        ...theirs.photos.map((p) => p.id),
      ]
      expect(ids.some((id) => aIds.has(id))).toBe(false)
      expect(theirs.deletedEntryIds.some((id) => aIds.has(id))).toBe(false)
    }
  })

  it("B's size estimate has none of A's journals", () => {
    const mine = a.sync.estimate()
    expect(mine.text.length).toBeGreaterThan(0)
    const aIds = new Set(mine.text.map((t) => t.journalId))
    const theirs = b.sync.estimate()
    expect(theirs.text.some((t) => aIds.has(t.journalId))).toBe(false)
    expect(theirs.files.some((f) => aIds.has(f.journalId))).toBe(false)
  })
})
