import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { entries, entryLocations, journals, photos } from '../db/schema.ts'
import { addUser, memoryDb } from '../test-helpers.ts'
import { JournalArchivedError } from './entries.ts'
import { createRepos } from './index.ts'
import { JournalDeletedError, TRASH_RETENTION_KEY, purgeExpiredTrash } from './trash.ts'
import { appSettingsRepo } from './appSettings.ts'

const T0 = 1_700_000_000_000
const DAY = 24 * 60 * 60 * 1000

let db: ReturnType<typeof memoryDb>['db']
let a: ReturnType<typeof createRepos>
let b: ReturnType<typeof createRepos>
let journal: string

beforeEach(async () => {
  db = memoryDb().db
  a = createRepos(db, (await addUser(db, 'a')).id)
  b = createRepos(db, (await addUser(db, 'b')).id)
  journal = a.journals.create({ name: 'J' }, T0).id
})

const write = (bodyMd: string, extra: Partial<Parameters<typeof a.entries.create>[0]> = {}) =>
  a.entries.create({ journalId: journal, timezone: 'UTC', bodyMd, ...extra }, T0).id

const addPhoto = (id: string) =>
  a.photos.add(
    {
      id,
      originalPath: `photos/x/${id}.jpg`,
      displayPath: null,
      thumbPath: null,
      mime: 'image/jpeg',
      width: 1,
      height: 1,
      bytes: 1,
      sha256: id,
      takenAt: null,
      latitude: null,
      longitude: null,
    },
    T0,
  )

const found = (q: string) => a.search.search({ q }).items.map((i) => i.id)

describe('trash: entries', () => {
  it('lists a deleted entry and restores it with its photos, searchable again', () => {
    addPhoto('p1')
    const id = write('Walrus day\n![](photo:p1)')
    a.entries.softDelete(id, T0 + 1000)
    expect(found('walrus')).toEqual([])

    const page = a.trash.entries()
    expect(page.items.map((i) => i.id)).toEqual([id])
    expect(page.items[0]).toMatchObject({
      title: 'Walrus day',
      photoCount: 1,
      deletedAt: T0 + 1000,
      purgeAt: T0 + 1000 + 60 * DAY,
    })
    expect(a.trash.count()).toEqual({ entries: 1, journals: 0 })

    const photoRev = db.select().from(photos).get()!.rev
    expect(a.trash.restoreEntry(id, T0 + 2000)?.deletedAt).toBeNull()
    expect(a.entries.get(id)).toBeDefined()
    expect(found('walrus')).toEqual([id])
    expect(a.trash.entries().items).toEqual([])
    // The feed sends the photo again: devices dropped it with the entry.
    expect(db.select().from(photos).get()!.rev).toBeGreaterThan(photoRev)
    expect(a.trash.restoreEntry(id)).toBeUndefined() // live now, so not in the trash
  })

  it('reads a trashed entry in full, only while it is in the trash with a live journal', () => {
    addPhoto('p1')
    const id = write('Walrus day\n![](photo:p1)', { tags: ['sea'] })
    expect(a.trash.entryDetail(id)).toBeUndefined() // live
    a.entries.softDelete(id, T0 + 1000)
    const d = a.trash.entryDetail(id)!
    expect(d.entry.bodyMd).toContain('Walrus day')
    expect(d.tags).toEqual(['sea'])
    expect(d.photos.map((p) => p.id)).toEqual(['p1'])
    expect(d).toMatchObject({ deletedAt: T0 + 1000, purgeAt: T0 + 1000 + 60 * DAY })
    a.trash.purgeEntry(id)
    expect(a.trash.entryDetail(id)).toBeUndefined() // purged: nothing left to read
    const other = write('in a trashed journal')
    a.journals.softDelete(journal, T0 + 2000)
    expect(a.trash.entryDetail(other)).toBeUndefined() // read it through the journal's restore
  })

  it('pages most recently deleted first', () => {
    const ids = [1, 2, 3].map((n) => {
      const id = write(`e${n}`)
      a.entries.softDelete(id, T0 + n * 1000)
      return id
    })
    const first = a.trash.entries({ limit: 2 })
    expect(first.items.map((i) => i.id)).toEqual([ids[2], ids[1]])
    const second = a.trash.entries({ limit: 2, cursor: first.nextCursor! })
    expect(second.items.map((i) => i.id)).toEqual([ids[0]])
    expect(second.nextCursor).toBeNull()
  })

  it('needs the journal live and writable to restore an entry', () => {
    const id = write('x')
    a.entries.softDelete(id, T0)
    a.journals.update(journal, { archived: true })
    expect(() => a.trash.restoreEntry(id)).toThrow(JournalArchivedError)
    a.journals.update(journal, { archived: false })
    a.journals.softDelete(journal, T0 + 10)
    expect(() => a.trash.restoreEntry(id)).toThrow(JournalDeletedError)
  })

  it('keeps tags on a trashed entry through a merge', () => {
    const id = write('x', { tags: ['Trip'] })
    write('y', { tags: ['Travel'] })
    a.entries.softDelete(id, T0)
    a.tags.merge('Trip', 'Travel')
    a.trash.restoreEntry(id)
    expect(a.entries.detail(id)?.tags).toEqual(['Travel'])
  })
})

describe('trash: journals', () => {
  it('restores a journal with the entries deleted with it, not ones deleted before', () => {
    const before = write('deleted on its own')
    const withIt = write('went with the journal')
    a.entries.softDelete(before, T0 + 10)
    a.journals.softDelete(journal, T0 + 20)

    expect(a.trash.journals()).toEqual([
      expect.objectContaining({ id: journal, name: 'J', entryCount: 1, deletedAt: T0 + 20 }),
    ])
    // Entries of a journal in the trash are not listed on their own.
    expect(a.trash.entries().items).toEqual([])
    expect(a.trash.count()).toEqual({ entries: 0, journals: 1 })

    expect(a.trash.restoreJournal(journal)?.deletedAt).toBeNull()
    expect(a.entries.get(withIt)).toBeDefined()
    expect(a.entries.get(before)).toBeUndefined()
    expect(a.trash.entries().items.map((i) => i.id)).toEqual([before])
  })
})

describe('trash: purging', () => {
  it('scrubs an entry and keeps the tombstone', () => {
    const id = write('Very private', {
      tags: ['secret'],
      mood: 'happy',
      location: {
        latitude: 1,
        longitude: 2,
        placeName: 'Home',
        locality: null,
        region: null,
        country: null,
        address: null,
        googlePlaceId: null,
      },
    })
    a.entries.softDelete(id, T0)
    expect(a.trash.purgeEntry(id, T0 + 5)).toBe(true)

    const row = db.select().from(entries).where(eq(entries.id, id)).get()!
    expect(row).toMatchObject({ bodyMd: '', moodKey: null, purgedAt: T0 + 5, deletedAt: T0 })
    expect(db.select().from(entryLocations).all()).toEqual([])
    expect(a.tags.list()).toEqual([])
    expect(a.trash.entries().items).toEqual([])
    expect(a.trash.restoreEntry(id)).toBeUndefined()
    expect(a.trash.purgeEntry(id)).toBe(false)
  })

  it('purges a journal and every deleted entry in it, and empties the rest', () => {
    const one = write('one')
    const two = write('two')
    a.entries.softDelete(one, T0)
    a.journals.softDelete(journal, T0 + 1)
    expect(a.trash.purgeJournal(journal, T0 + 2)).toEqual({ entries: 2, journals: 1 })
    expect(db.select().from(journals).where(eq(journals.id, journal)).get()?.name).toBe('')
    expect(db.select().from(entries).where(eq(entries.id, two)).get()?.purgedAt).toBe(T0 + 2)

    const other = a.journals.create({ name: 'K' }, T0).id
    const three = a.entries.create({ journalId: other, timezone: 'UTC', bodyMd: 'x' }, T0).id
    a.entries.softDelete(three, T0)
    expect(a.trash.empty(T0 + 3)).toEqual({ entries: 1, journals: 0 })
    expect(a.trash.count()).toEqual({ entries: 0, journals: 0 })
  })

  it('expires what has been in the trash past the retention', () => {
    const old = write('old')
    const recent = write('recent')
    a.entries.softDelete(old, T0)
    a.entries.softDelete(recent, T0 + 30 * DAY)

    const at = T0 + 61 * DAY
    expect(purgeExpiredTrash(db, 60, at, { dryRun: true })).toEqual({ entries: 1, journals: 0 })
    expect(a.trash.count().entries).toBe(2) // the dry run changed nothing
    expect(purgeExpiredTrash(db, 60, at)).toEqual({ entries: 1, journals: 0 })
    expect(a.trash.entries().items.map((i) => i.id)).toEqual([recent])
    expect(purgeExpiredTrash(db, 7, at)).toEqual({ entries: 1, journals: 0 })
  })

  it('keeps a purged Day One entry from coming back on re-import', () => {
    const entry = {
      sourceId: 'DAYONE-1',
      journalId: journal,
      bodyMd: 'imported',
      createdAt: T0,
      modifiedAt: T0,
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
    expect(a.imports.importEntry(entry, T0)).toBe('imported')
    const id = db.select().from(entries).where(eq(entries.sourceId, 'DAYONE-1')).get()!.id
    a.entries.softDelete(id, T0)
    a.trash.purgeEntry(id, T0)
    expect(a.imports.importEntry(entry, T0)).toBe('skipped')
  })
})

describe('trash: retention setting', () => {
  it('reads the admin setting and falls back to the default', () => {
    const id = write('x')
    a.entries.softDelete(id, T0)
    appSettingsRepo(db).set(TRASH_RETENTION_KEY, '7')
    expect(a.trash.entries().items[0]?.purgeAt).toBe(T0 + 7 * DAY)
    appSettingsRepo(db).set(TRASH_RETENTION_KEY, '8') // not a choice
    expect(a.trash.entries().items[0]?.purgeAt).toBe(T0 + 60 * DAY)
  })
})

describe('trash: user scoping', () => {
  it("B cannot see, restore or purge A's trash", () => {
    const id = write('secret')
    a.entries.softDelete(id, T0)
    const other = a.journals.create({ name: 'K' }, T0).id
    a.journals.softDelete(other, T0)

    expect(b.trash.entries().items).toEqual([])
    expect(b.trash.journals()).toEqual([])
    expect(b.trash.count()).toEqual({ entries: 0, journals: 0 })
    expect(b.trash.entryDetail(id)).toBeUndefined()
    expect(b.trash.restoreEntry(id)).toBeUndefined()
    expect(b.trash.restoreJournal(other)).toBeUndefined()
    expect(b.trash.purgeEntry(id)).toBe(false)
    expect(b.trash.purgeJournal(other)).toBeNull()
    expect(b.trash.empty()).toEqual({ entries: 0, journals: 0 })

    expect(a.trash.count()).toEqual({ entries: 1, journals: 1 })
    expect(db.select().from(entries).where(eq(entries.id, id)).get()?.bodyMd).toBe('secret')
  })
})
