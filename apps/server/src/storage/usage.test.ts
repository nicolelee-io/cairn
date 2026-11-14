import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createRepos } from '../repo/index.ts'
import { addUser, memoryDb } from '../test-helpers.ts'
import { adminUsage, userUsage } from './usage.ts'

const T0 = 1_700_000_000_000
const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

async function world() {
  const dataDir = mkdtempSync(join(tmpdir(), 'cairn-usage-'))
  dirs.push(dataDir)
  const db = memoryDb().db
  const write = (rel: string, size: number) => {
    mkdirSync(dirname(join(dataDir, rel)), { recursive: true })
    writeFileSync(join(dataDir, rel), Buffer.alloc(size))
  }

  const userWith = async (name: string) => {
    const u = await addUser(db, name)
    const repos = createRepos(db, u.id)
    /** A photo whose original is 100 bytes, display 10 and thumb 1, unless `write` is false. */
    const photo = (id: string, sha: string, files = true) => {
      const p = (kind: string, ext: string) => `photos/${u.id}/${kind}/${sha}.${ext}`
      if (files) {
        write(p('originals', 'jpg'), 100)
        write(p('display', 'webp'), 10)
        write(p('thumb', 'webp'), 1)
      }
      repos.photos.add(
        {
          id,
          originalPath: p('originals', 'jpg'),
          displayPath: p('display', 'webp'),
          thumbPath: p('thumb', 'webp'),
          mime: 'image/jpeg',
          width: 1,
          height: 1,
          bytes: 100,
          sha256: sha,
          takenAt: null,
          latitude: null,
          longitude: null,
        },
        T0,
      )
    }
    const attachment = (id: string, sha: string, kind: 'video' | 'pdf', size: number) => {
      const path = `attachments/${u.id}/${sha}.${kind === 'pdf' ? 'pdf' : 'mp4'}`
      write(path, size)
      repos.attachments.add(
        {
          id,
          kind,
          path,
          mime: kind === 'pdf' ? 'application/pdf' : 'video/mp4',
          bytes: size,
          sha256: sha,
          filename: 'f',
        },
        T0,
      )
    }
    const entry = (journalId: string, bodyMd: string) =>
      repos.entries.create({ journalId, timezone: 'UTC', bodyMd }, T0)
    return { u, repos, photo, attachment, entry }
  }
  return { db, dataDir, write, userWith }
}

const textOf = (...bodies: string[]) => bodies.reduce((n, b) => n + Buffer.byteLength(b), 0)

describe('userUsage', () => {
  it('sums text and files per journal, and a shared file once in the total', async () => {
    const { db, dataDir, write, userWith } = await world()
    const a = await userWith('a')
    const j1 = a.repos.journals.create({ name: 'One' }, T0)
    const j2 = a.repos.journals.create({ name: 'Two' }, T0)
    a.photo('p1', 'aaa')
    a.photo('p2', 'aaa') // the same bytes again: same files
    a.attachment('v1', 'vvv', 'video', 1000)
    a.attachment('d1', 'ddd', 'pdf', 50)
    const b1 = '![](photo:p1)\n\n![f](attachment:v1)'
    const b2 = '![](photo:p2) ![f](attachment:d1) héllo'
    a.entry(j1.id, b1)
    a.entry(j2.id, b2)
    write(`photos/${a.u.id}/avatar.webp`, 7)

    const usage = await userUsage(db, dataDir, a.u.id)
    expect(usage.textBytes).toBe(textOf(b1, b2))
    expect(usage.photos).toEqual({ count: 2, originalBytes: 100, copyBytes: 11 })
    expect(usage.attachments).toEqual({ count: 2, videoBytes: 1000, audioBytes: 0, pdfBytes: 50 })
    expect(usage.avatarBytes).toBe(7)
    expect(usage.pending).toEqual({ files: 0, bytes: 0 })
    expect(usage.totalBytes).toBe(textOf(b1, b2) + 111 + 1050 + 7)

    const one = usage.journals.find((j) => j.journalId === j1.id)
    const two = usage.journals.find((j) => j.journalId === j2.id)
    expect(one).toEqual({
      journalId: j1.id,
      entries: 1,
      textBytes: textOf(b1),
      photos: 1,
      photoBytes: 111,
      attachments: 1,
      attachmentBytes: 1000,
    })
    // The shared photo counts in each journal that shows it.
    expect(two).toMatchObject({ photos: 1, photoBytes: 111, attachmentBytes: 50 })
  })

  it('counts files of entries in the trash as trash, and pending once purged', async () => {
    const { db, dataDir, userWith } = await world()
    const a = await userWith('a')
    const j = a.repos.journals.create({ name: 'J' }, T0)
    a.photo('p', 'ppp')
    a.photo('shared', 'kkk')
    a.photo('live', 'kkk') // same file as `shared`, in a live entry
    const body = '![](photo:p) ![](photo:shared)'
    const gone = a.entry(j.id, body)
    a.entry(j.id, '![](photo:live)')
    a.repos.entries.softDelete(gone.id, T0)

    const usage = await userUsage(db, dataDir, a.u.id)
    // p's three files and the text; the shared file stays in use, so it counts there instead.
    expect(usage.trash).toEqual({ entries: 1, files: 3, bytes: 111 + Buffer.byteLength(body) })
    expect(usage.pending).toEqual({ files: 0, bytes: 0 })

    a.repos.trash.purgeEntry(gone.id, T0)
    const after = await userUsage(db, dataDir, a.u.id)
    expect(after.trash).toEqual({ entries: 0, files: 0, bytes: 0 })
    expect(after.pending).toEqual({ files: 3, bytes: 111 })
  })

  it('counts files only deleted or never-saved rows hold as pending, not as in use', async () => {
    const { db, dataDir, userWith } = await world()
    const a = await userWith('a')
    const j = a.repos.journals.create({ name: 'J' }, T0)
    a.photo('kept', 'kkk')
    a.photo('removed', 'rrr')
    a.photo('unsaved', 'uuu') // uploaded, never saved into an entry
    a.photo('shared-del', 'kkk') // deleted, but its file is the live photo's
    a.photo('in-deleted', 'eee')
    a.attachment('v-deleted', 'vvv', 'video', 500)
    const e = a.entry(j.id, '![](photo:kept) ![](photo:removed) ![](photo:shared-del)')
    a.repos.entries.update(e.id, { bodyMd: '![](photo:kept)' }, { baseRev: e.rev }, T0)
    const gone = a.entry(j.id, '![](photo:in-deleted) ![f](attachment:v-deleted)')
    a.repos.entries.softDelete(gone.id, T0)
    const old = a.repos.journals.create({ name: 'Deleted' }, T0)
    a.repos.journals.softDelete(old.id, T0)

    const usage = await userUsage(db, dataDir, a.u.id)
    expect(usage.photos).toEqual({ count: 1, originalBytes: 100, copyBytes: 11 })
    expect(usage.attachments.count).toBe(0)
    // removed and unsaved: two photos of three files each. The deleted entry's photo and video
    // are in the trash, not pending.
    expect(usage.pending).toEqual({ files: 6, bytes: 2 * 111 })
    expect(usage.trash).toMatchObject({ entries: 1, files: 4 })
    expect(usage.journals.map((x) => x.journalId)).toEqual([j.id])
    expect(usage.journals[0]).toMatchObject({ entries: 1, photos: 1, photoBytes: 111 })
  })

  it('counts a missing file as nothing', async () => {
    const { db, dataDir, userWith } = await world()
    const a = await userWith('a')
    const j = a.repos.journals.create({ name: 'J' }, T0)
    a.photo('p', 'mmm', false)
    a.entry(j.id, '![](photo:p)')
    const usage = await userUsage(db, dataDir, a.u.id)
    expect(usage.photos).toEqual({ count: 1, originalBytes: 0, copyBytes: 0 })
    expect(usage.journals[0]!.photoBytes).toBe(0)
  })

  it("never counts another user's files", async () => {
    const { db, dataDir, userWith } = await world()
    const a = await userWith('a')
    const b = await userWith('b')
    const ja = a.repos.journals.create({ name: 'A' }, T0)
    a.photo('pa', 'same')
    a.entry(ja.id, '![](photo:pa)')
    b.repos.journals.create({ name: 'B' }, T0)

    const usage = await userUsage(db, dataDir, b.u.id)
    expect(usage.totalBytes).toBe(0)
    expect(usage.photos.count).toBe(0)
    expect(usage.journals.map((j) => j.journalId)).not.toContain(ja.id)
  })
})

describe('adminUsage', () => {
  it("gives each user's totals, nothing about their journals, and the server's files", async () => {
    const { db, dataDir, write, userWith } = await world()
    const a = await userWith('alice')
    const small = a.repos.journals.create({ name: 'Secret small journal' }, T0)
    const big = a.repos.journals.create({ name: 'Secret big journal' }, T0)
    a.photo('p', 'ppp')
    a.entry(small.id, 'hi')
    a.entry(big.id, '![](photo:p)')
    await userWith('bob')
    write('cairn.db', 300)
    write('cairn.db-wal', 20)
    write('backups/pre-migrate-1.db', 40)
    write('backups/backup-status.json', 2)

    const report = await adminUsage(db, dataDir)
    const alice = report.users.find((u) => u.username === 'alice')!
    expect(alice).toMatchObject({
      totalBytes: textOf('hi', '![](photo:p)') + 111,
      textBytes: textOf('hi', '![](photo:p)'),
      photoBytes: 111,
      attachmentBytes: 0,
      pendingBytes: 0,
    })
    expect(report.users.find((u) => u.username === 'bob')).toMatchObject({ totalBytes: 0 })
    expect(report.server).toEqual({ databaseBytes: 320, backupsBytes: 42 })

    const raw = JSON.stringify(report)
    for (const leak of [small.id, big.id, 'Secret']) expect(raw).not.toContain(leak)
  })
})
