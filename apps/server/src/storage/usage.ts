import { join } from 'node:path'
import type { AdminStorage, StorageUsage } from '@cairn/shared'
import type { Db } from '../db/index.ts'
import { storageRepo } from '../repo/storage.ts'
import { listUsers } from '../repo/users.ts'
import { dirSize, fileSizes } from './files.ts'

interface JournalFiles {
  photos: number
  photoPaths: Set<string>
  attachments: number
  attachmentPaths: Set<string>
}

/**
 * What one user's data takes on the server (GET /api/storage). Files are measured on disk and
 * each counts once in the totals, however many photos share it; a journal counts every file its
 * entries show. Files entries in the trash use (and nothing live shows) are `trash`; files only
 * deleted or never-saved rows point at are `pending`.
 */
export async function userUsage(db: Db, dataDir: string, userId: string): Promise<StorageUsage> {
  const repo = storageRepo(db, userId)
  const journals = repo.journals()
  const byJournal = new Map<string, JournalFiles>()
  const files = (journalId: string) => {
    let f = byJournal.get(journalId)
    if (!f) {
      f = { photos: 0, photoPaths: new Set(), attachments: 0, attachmentPaths: new Set() }
      byJournal.set(journalId, f)
    }
    return f
  }

  const originals = new Set<string>()
  const copies = new Set<string>()
  const attachmentKinds = new Map<string, 'video' | 'audio' | 'pdf'>()
  const notShown = new Set<string>()
  const trashed = new Set<string>()
  let photoCount = 0
  let attachmentCount = 0

  for (const p of repo.photoFiles()) {
    const paths = [p.originalPath, p.displayPath, p.thumbPath].filter((x): x is string => !!x)
    if (!p.live || !p.journalId) {
      for (const x of paths) (p.trashed ? trashed : notShown).add(x)
      continue
    }
    photoCount++
    originals.add(p.originalPath)
    if (p.displayPath) copies.add(p.displayPath)
    if (p.thumbPath) copies.add(p.thumbPath)
    const f = files(p.journalId)
    f.photos++
    for (const x of paths) f.photoPaths.add(x)
  }
  for (const a of repo.attachmentFiles()) {
    if (!a.live || !a.journalId) {
      ;(a.trashed ? trashed : notShown).add(a.path)
      continue
    }
    attachmentCount++
    attachmentKinds.set(a.path, a.kind)
    const f = files(a.journalId)
    f.attachments++
    f.attachmentPaths.add(a.path)
  }
  // Shared by sha256: a file a live row still shows is in use, whatever other rows say, and one
  // an entry in the trash uses isn't waiting for the cleanup yet.
  const shownPath = (x: string) => originals.has(x) || copies.has(x) || attachmentKinds.has(x)
  const inTrash = [...trashed].filter((x) => !shownPath(x))
  const pending = [...notShown].filter((x) => !shownPath(x) && !trashed.has(x))
  const trashText = repo.trashText()

  const avatar = `photos/${userId}/avatar.webp`
  const sizes = await fileSizes(dataDir, [
    ...originals,
    ...copies,
    ...attachmentKinds.keys(),
    ...inTrash,
    ...pending,
    avatar,
  ])
  const sum = (paths: Iterable<string>) => {
    let n = 0
    for (const p of paths) n += sizes.get(p) ?? 0
    return n
  }
  const byKind = { video: 0, audio: 0, pdf: 0 }
  for (const [path, kind] of attachmentKinds) byKind[kind] += sizes.get(path) ?? 0

  const textBytes = journals.reduce((n, j) => n + j.textBytes, 0)
  const originalBytes = sum(originals)
  const copyBytes = sum(copies)
  const avatarBytes = sizes.get(avatar) ?? 0
  const pendingBytes = sum(pending)
  const trashBytes = trashText.textBytes + sum(inTrash)
  return {
    totalBytes:
      textBytes +
      originalBytes +
      copyBytes +
      byKind.video +
      byKind.audio +
      byKind.pdf +
      avatarBytes +
      trashBytes +
      pendingBytes,
    textBytes,
    photos: { count: photoCount, originalBytes, copyBytes },
    attachments: {
      count: attachmentCount,
      videoBytes: byKind.video,
      audioBytes: byKind.audio,
      pdfBytes: byKind.pdf,
    },
    avatarBytes,
    trash: {
      entries: trashText.entries,
      files: inTrash.filter((p) => sizes.has(p)).length,
      bytes: trashBytes,
    },
    pending: { files: pending.filter((p) => sizes.has(p)).length, bytes: pendingBytes },
    journals: journals.map((j) => {
      const f = byJournal.get(j.journalId)
      return {
        journalId: j.journalId,
        entries: j.entries,
        textBytes: j.textBytes,
        photos: f?.photos ?? 0,
        photoBytes: f ? sum(f.photoPaths) : 0,
        attachments: f?.attachments ?? 0,
        attachmentBytes: f ? sum(f.attachmentPaths) : 0,
      }
    }),
  }
}

/**
 * Sizes for every user and for the server (GET /api/admin/storage). Maintenance, so across users,
 * but it hands back each user's totals only, nothing about their journals.
 */
export async function adminUsage(db: Db, dataDir: string): Promise<AdminStorage> {
  const users: AdminStorage['users'] = []
  for (const u of listUsers(db)) {
    const usage = await userUsage(db, dataDir, u.id)
    const a = usage.attachments
    users.push({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      totalBytes: usage.totalBytes,
      textBytes: usage.textBytes,
      photoBytes: usage.photos.originalBytes + usage.photos.copyBytes,
      attachmentBytes: a.videoBytes + a.audioBytes + a.pdfBytes,
      trashBytes: usage.trash.bytes,
      pendingBytes: usage.pending.bytes,
    })
  }
  const dbFiles = await fileSizes(dataDir, ['cairn.db', 'cairn.db-wal', 'cairn.db-shm'])
  return {
    users,
    server: {
      databaseBytes: [...dbFiles.values()].reduce((n, x) => n + x, 0),
      backupsBytes: await dirSize(join(dataDir, 'backups')),
    },
  }
}
