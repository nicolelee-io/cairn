import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { attachments, photos } from '../db/schema.ts'
import { createRepos } from '../repo/index.ts'
import { addUser, memoryDb } from '../test-helpers.ts'
import {
  collectMediaGarbage,
  FILES_KEPT_MS,
  ORPHAN_AFTER_MS,
  STRAY_AFTER_MS,
  TMP_AFTER_MS,
  type CleanupResult,
} from './gc.ts'

const T0 = 1_700_000_000_000
let dir: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'cairn-gc-'))
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function setup() {
  const db = memoryDb().db
  return addUser(db, 'a').then((u) => {
    const repos = createRepos(db, u.id)
    const add = (id: string, sha: string) => {
      const path = `photos/${u.id}/originals/${sha}.jpg`
      mkdirSync(dirname(join(dir, path)), { recursive: true })
      writeFileSync(join(dir, path), 'x')
      repos.photos.add(
        {
          id,
          originalPath: path,
          displayPath: null,
          thumbPath: null,
          mime: 'image/jpeg',
          width: 1,
          height: 1,
          bytes: 1,
          sha256: sha,
          takenAt: null,
          latitude: null,
          longitude: null,
        },
        T0,
      )
      return join(dir, path)
    }
    const addAttachment = (id: string, sha: string) => {
      const path = `attachments/${u.id}/${sha}.pdf`
      mkdirSync(dirname(join(dir, path)), { recursive: true })
      writeFileSync(join(dir, path), 'x')
      repos.attachments.add(
        {
          id,
          kind: 'pdf',
          path,
          mime: 'application/pdf',
          bytes: 1,
          sha256: sha,
          filename: 'f.pdf',
        },
        T0,
      )
      return join(dir, path)
    }
    return { db, repos, add, addAttachment, userId: u.id }
  })
}

const report = (counts: Partial<CleanupResult> = {}): CleanupResult => ({
  dryRun: false,
  abandoned: 0,
  ofPurgedEntries: 0,
  files: 0,
  stray: 0,
  bytes: 0,
  missing: 0,
  missingPaths: [],
  ...counts,
})

/** Writes a file under the data dir with its mtime set to `mtime`. */
function writeAt(rel: string, mtime: number, body = 'x') {
  const file = join(dir, rel)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, body)
  utimesSync(file, mtime / 1000, mtime / 1000)
  return file
}

describe('collectMediaGarbage', () => {
  it('tombstones abandoned uploads, then removes their files after the grace period', async () => {
    const { db, add } = await setup()
    const file = add('p1', 'aaa')
    const young = collectMediaGarbage(db, dir, T0 + ORPHAN_AFTER_MS - 1)
    expect(young).toEqual(report())
    const day = T0 + ORPHAN_AFTER_MS + 1
    expect(collectMediaGarbage(db, dir, day)).toEqual(report({ abandoned: 1 }))
    expect(existsSync(file)).toBe(true)
    expect(collectMediaGarbage(db, dir, day + FILES_KEPT_MS + 1)).toEqual(
      report({ files: 1, bytes: 1 }),
    )
    expect(existsSync(file)).toBe(false)
    expect(db.select().from(photos).all()).toHaveLength(1) // the tombstone stays for sync
  })

  it("never touches a live entry's photos and files, however old", async () => {
    const { db, repos, add, addAttachment } = await setup()
    const photo = add('live-p', 'lll')
    const file = addAttachment('live-a', 'mmm')
    const j = repos.journals.create({ name: 'J' }, T0)
    repos.entries.create(
      { journalId: j.id, timezone: 'UTC', bodyMd: '![](photo:live-p)\n![f](attachment:live-a)' },
      T0,
    )
    const rows = () => [...db.select().from(photos).all(), ...db.select().from(attachments).all()]
    const before = rows()
    expect(collectMediaGarbage(db, dir, T0 + 10 * FILES_KEPT_MS)).toEqual(report())
    expect([photo, file].map(existsSync)).toEqual([true, true])
    expect(rows()).toEqual(before) // not even a new rev
  })

  it('keeps a file that a live photo still uses', async () => {
    const { db, add, repos } = await setup()
    add('p2', 'bbb')
    const shared = add('p3', 'bbb') // same bytes, same path
    const j = repos.journals.create({ name: 'J' }, T0)
    repos.entries.create(
      { journalId: j.id, timezone: 'UTC', bodyMd: '![](photo:p3)' }, // attaches p3
      T0,
    )
    repos.photos.remove('p2', T0)
    collectMediaGarbage(db, dir, T0 + FILES_KEPT_MS + 10)
    expect(existsSync(shared)).toBe(true)
  })
})

describe('collectMediaGarbage on attachments', () => {
  it('treats abandoned attachment uploads like photos, and keeps shared files', async () => {
    const { db, repos, addAttachment } = await setup()
    const lone = addAttachment('a1', 'ccc')
    addAttachment('a2', 'ddd')
    const shared = addAttachment('a3', 'ddd')
    const j = repos.journals.create({ name: 'J' }, T0)
    repos.entries.create({ journalId: j.id, timezone: 'UTC', bodyMd: '![x](attachment:a3)' }, T0)
    const day = T0 + ORPHAN_AFTER_MS + 1
    expect(collectMediaGarbage(db, dir, day)).toEqual(report({ abandoned: 2 }))
    expect(collectMediaGarbage(db, dir, day + FILES_KEPT_MS + 1)).toEqual(
      report({ files: 1, bytes: 1 }),
    )
    expect(existsSync(lone)).toBe(false)
    expect(existsSync(shared)).toBe(true)
    expect(db.select().from(attachments).all()).toHaveLength(3)
  })
})

describe('collectMediaGarbage on deleted entries', () => {
  it('keeps the media of an entry in the trash, then frees them as soon as it is purged', async () => {
    const { db, repos, add, addAttachment } = await setup()
    const photo = add('p4', 'eee')
    const file = addAttachment('a4', 'fff')
    const j = repos.journals.create({ name: 'J' }, T0)
    const e = repos.entries.create(
      { journalId: j.id, timezone: 'UTC', bodyMd: '![](photo:p4)\n![f](attachment:a4)' },
      T0,
    )
    const deleted = T0 + 1000
    repos.entries.softDelete(e.id, deleted)

    // In the trash: however long, the media stay whole (a restore gets them back).
    const later = deleted + 3 * FILES_KEPT_MS
    expect(collectMediaGarbage(db, dir, later)).toEqual(report())
    expect(db.select().from(photos).get()?.deletedAt).toBeNull()

    const purged = later + 1000
    repos.trash.purgeEntry(e.id, purged)
    expect(collectMediaGarbage(db, dir, purged + 1)).toEqual(
      report({ ofPurgedEntries: 2, files: 2, bytes: 2 }),
    )
    expect(existsSync(photo)).toBe(false)
    expect(existsSync(file)).toBe(false)
    // Tombstoned as of the purge, with a new rev for sync.
    const row = db.select().from(photos).get()
    expect(row?.deletedAt).toBe(purged)
    expect(row?.updatedAt).toBe(purged + 1)
    expect(collectMediaGarbage(db, dir, purged + 2)).toEqual(report())
  })

  it('covers a purged journal, and keeps a file a live entry shares', async () => {
    const { db, repos, add } = await setup()
    add('p5', 'ggg')
    const shared = add('p6', 'ggg')
    const gone = repos.journals.create({ name: 'Gone' }, T0)
    const kept = repos.journals.create({ name: 'Kept' }, T0)
    repos.entries.create({ journalId: gone.id, timezone: 'UTC', bodyMd: '![](photo:p5)' }, T0)
    repos.entries.create({ journalId: kept.id, timezone: 'UTC', bodyMd: '![](photo:p6)' }, T0)
    repos.journals.softDelete(gone.id, T0)
    expect(collectMediaGarbage(db, dir, T0 + FILES_KEPT_MS + 1)).toEqual(report())

    repos.trash.purgeJournal(gone.id, T0 + 10)
    expect(collectMediaGarbage(db, dir, T0 + 20)).toEqual(report({ ofPurgedEntries: 1 }))
    expect(existsSync(shared)).toBe(true)
  })
})

describe('collectMediaGarbage on files nothing names', () => {
  it('removes old stray and temp files in a user folder, and leaves the rest', async () => {
    const { db, userId } = await setup()
    const now = Date.now()
    const old = writeAt(`photos/${userId}/originals/old.jpg`, now - STRAY_AFTER_MS - 1, 'abc')
    const young = writeAt(`photos/${userId}/display/young.webp`, now - STRAY_AFTER_MS + 60_000)
    const tmp = writeAt(`attachments/${userId}/.upload-1.tmp`, now - TMP_AFTER_MS - 1)
    const freshTmp = writeAt(`attachments/${userId}/.upload-2.tmp`, now - 1000)
    const avatar = writeAt(`photos/${userId}/avatar.webp`, now - 365 * STRAY_AFTER_MS)
    // A folder no user owns is not this cleanup's business.
    const unknown = writeAt('photos/nobody/originals/x.jpg', now - 365 * STRAY_AFTER_MS)

    expect(collectMediaGarbage(db, dir, now)).toEqual(report({ stray: 2, bytes: 4 }))
    expect([old, young, tmp, freshTmp, avatar, unknown].map(existsSync)).toEqual([
      false,
      true,
      false,
      true,
      true,
      true,
    ])
  })

  it('counts rows in use whose file is gone, and leaves them alone', async () => {
    const { db, repos, add } = await setup()
    const file = add('p7', 'hhh')
    const j = repos.journals.create({ name: 'J' }, T0)
    repos.entries.create({ journalId: j.id, timezone: 'UTC', bodyMd: '![](photo:p7)' }, T0)
    rmSync(file)
    const r = collectMediaGarbage(db, dir, T0 + FILES_KEPT_MS + 1)
    expect(r.missing).toBe(1)
    expect(r.missingPaths).toEqual([expect.stringMatching(/originals\/hhh\.jpg$/)])
    expect(db.select().from(photos).get()?.deletedAt).toBeNull()
  })
})

describe('collectMediaGarbage dry run', () => {
  it('reports what a real run would do and changes nothing', async () => {
    const { db, repos, add, userId } = await setup()
    const abandoned = add('p8', 'iii')
    const inEntry = add('p9', 'jjj')
    const j = repos.journals.create({ name: 'J' }, T0)
    const e = repos.entries.create(
      { journalId: j.id, timezone: 'UTC', bodyMd: '![](photo:p9)' },
      T0,
    )
    repos.entries.softDelete(e.id, T0)
    repos.trash.purgeEntry(e.id, T0)
    const now = Date.now() // past T0 + 30 days, and the stray file is old enough
    const stray = writeAt(`photos/${userId}/thumb/stray.webp`, now - STRAY_AFTER_MS - 1)
    const before = db.select().from(photos).all()

    const dry = collectMediaGarbage(db, dir, now, { dryRun: true })
    expect(dry).toEqual(
      // The abandoned upload is tombstoned as of now, so its file waits out its own 30 days.
      report({ dryRun: true, abandoned: 1, ofPurgedEntries: 1, files: 1, stray: 1, bytes: 2 }),
    )
    expect(db.select().from(photos).all()).toEqual(before)
    expect([abandoned, inEntry, stray].map(existsSync)).toEqual([true, true, true])

    expect(collectMediaGarbage(db, dir, now)).toEqual(
      report({ abandoned: 1, ofPurgedEntries: 1, files: 1, stray: 1, bytes: 2 }),
    )
    expect([abandoned, inEntry, stray].map(existsSync)).toEqual([true, false, false])
  })
})
