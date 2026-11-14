import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { and, eq, isNull } from 'drizzle-orm'
import type { CleanupReport } from '@cairn/shared'
import type { Db } from '../db/index.ts'
import { attachments, entries, photos, users } from '../db/schema.ts'
import { nextRev } from '../repo/rev.ts'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
/** An upload that no saved entry has claimed after this long was abandoned (closed tab, discarded draft). */
export const ORPHAN_AFTER_MS = DAY_MS
/**
 * Files of a photo or attachment removed from an entry stay this long, as an undo window and a
 * margin for backups. Deleted entries have the trash instead (repo/trash.ts).
 */
export const FILES_KEPT_MS = 30 * DAY_MS
/** A file no row names is left this long first: an upload writes its file before its row. */
export const STRAY_AFTER_MS = DAY_MS
/** A temp file this old belongs to an upload that died (a finished one renames or removes it). */
export const TMP_AFTER_MS = HOUR_MS

/** The trash's expiry counts are added by the caller (`purgeExpiredTrash` runs first). */
export type CleanupResult = Omit<CleanupReport, 'expiredEntries' | 'expiredJournals'> & {
  /** Data-dir-relative paths of the missing files, for the server log (never sent to the app). */
  missingPaths: string[]
}

/**
 * Maintenance, so deliberately not scoped to one user (like `purgeExpiredSessions`), for photos
 * and attachments alike:
 * 1. tombstones uploads that never got attached to an entry, and the media of purged entries
 *    (deleted for good from the trash; with the entry's `purgedAt`). Media of entries still in
 *    the trash stay live, so a restore gets them back whole;
 * 2. deletes the files of rows tombstoned long ago, or of purged entries at once (the trash was
 *    their undo window), unless a live or recently deleted row of the same kind still uses the
 *    same file (files are shared by sha256);
 * 3. deletes files in each user's folders that no row names at all (old temp files, uploads
 *    whose row never got written), never the avatar;
 * 4. counts live rows whose file is gone.
 * The rows stay as tombstones for sync. `dryRun` reports the same numbers and changes nothing.
 * Synchronous on purpose: the daily run and the admin button can never interleave.
 */
export function collectMediaGarbage(
  db: Db,
  dataDir: string,
  now = Date.now(),
  { dryRun = false } = {},
): CleanupResult {
  const root = resolve(dataDir)
  const cutoff = now - FILES_KEPT_MS
  const report: CleanupResult = {
    dryRun,
    abandoned: 0,
    ofPurgedEntries: 0,
    files: 0,
    stray: 0,
    bytes: 0,
    missing: 0,
    missingPaths: [],
  }
  const userIds = db
    .select({ id: users.id })
    .from(users)
    .all()
    .map((u) => u.id)
  const removed = new Set<string>()
  const remove = (rel: string, file: string) => {
    if (removed.has(rel)) return false
    removed.add(rel)
    report.bytes += statSync(file).size
    if (!dryRun) rmSync(file)
    return true
  }

  for (const kind of KINDS) {
    const t = kind.table as typeof photos // same sync columns; see repo/media.ts
    const rows = kind.load(db)

    // 1. Work out each row's deletedAt after this run, then write the new tombstones.
    const tombstones: { id: string; userId: string; deletedAt: number }[] = []
    for (const r of rows) {
      if (r.deletedAt !== null) continue
      if (r.entryId === null && r.createdAt < now - ORPHAN_AFTER_MS) {
        r.deletedAt = now
        report.abandoned++
      } else if (isTime(r.entryPurgedAt)) {
        r.deletedAt = r.entryPurgedAt
        report.ofPurgedEntries++
      } else continue
      tombstones.push({ id: r.id, userId: r.userId, deletedAt: r.deletedAt })
    }
    if (!dryRun && tombstones.length) {
      db.transaction((tx) => {
        for (const x of tombstones) {
          tx.update(t)
            .set({ deletedAt: x.deletedAt, updatedAt: now, rev: nextRev(tx, x.userId) })
            .where(and(eq(t.id, x.id), isNull(t.deletedAt)))
            .run()
        }
      })
    }

    // 2. Files only rows deleted before the cutoff, or rows of purged entries, point at.
    // Fail safe: a row counts as gone only on a real timestamp, so a missing or misnamed field
    // keeps its files (a half-edited version of this file once deleted every live photo in dev).
    const inUse = (r: MediaRow) =>
      !isTime(r.entryPurgedAt) && !(isTime(r.deletedAt) && r.deletedAt < cutoff)
    const keep = new Set(rows.filter(inUse).flatMap((r) => r.paths))
    for (const r of rows) {
      if (inUse(r)) continue
      for (const rel of r.paths) {
        if (keep.has(rel)) continue
        const file = resolve(root, rel)
        // Only ever inside this user's own folder, whatever the row says.
        if (!file.startsWith(`${join(root, kind.folder, r.userId)}${sep}`)) continue
        if (!existsSync(file)) continue
        if (remove(rel, file)) report.files++
      }
    }

    // 3. Files no row of any state names, in the folders of users that exist.
    const named = new Set(rows.flatMap((r) => r.paths))
    for (const userId of userIds) {
      const dir = join(root, kind.folder, userId)
      if (!existsSync(dir)) continue
      for (const d of readdirSync(dir, { recursive: true, withFileTypes: true })) {
        if (!d.isFile()) continue
        const file = join(d.parentPath, d.name)
        const rel = relative(root, file).split(sep).join('/')
        if (named.has(rel) || rel === `photos/${userId}/avatar.webp`) continue
        const age = now - statSync(file).mtimeMs
        if (age < (d.name.endsWith('.tmp') ? TMP_AFTER_MS : STRAY_AFTER_MS)) continue
        if (remove(rel, file)) report.stray++
      }
    }

    // 4. Rows still in use whose file is gone (a bad restore, a hand-deleted file).
    for (const r of rows) {
      if (r.deletedAt !== null) continue
      const gone = r.paths.filter((rel) => !existsSync(resolve(root, rel)))
      if (gone.length === 0) continue
      report.missing++
      for (const rel of gone) if (!report.missingPaths.includes(rel)) report.missingPaths.push(rel)
    }
  }
  return report
}

/** One line for the server log, or null when there was nothing to do or report. */
export function describeCleanup(r: CleanupResult): string | null {
  const parts = [
    r.abandoned && `${r.abandoned} abandoned upload(s)`,
    r.ofPurgedEntries && `${r.ofPurgedEntries} photo(s)/attachment(s) of purged entries`,
    r.files && `${r.files} deleted file(s)`,
    r.stray && `${r.stray} file(s) nothing named`,
    r.bytes && `${r.bytes} bytes freed`,
    r.missing &&
      `${r.missing} in use with a missing file: ${r.missingPaths.slice(0, 20).join(', ')}${r.missingPaths.length > 20 ? ', ...' : ''}`,
  ].filter(Boolean)
  return parts.length ? `media cleanup${r.dryRun ? ' (dry run)' : ''}: ${parts.join('; ')}` : null
}

interface MediaRow {
  id: string
  userId: string
  entryId: string | null
  createdAt: number
  deletedAt: number | null
  entryPurgedAt: number | null
  paths: string[]
}

const present = (p: string | null | undefined): p is string => !!p
/** A set timestamp; null and undefined (a field the query didn't load) are not. */
const isTime = (t: number | null | undefined): t is number => typeof t === 'number'

const KINDS = [
  {
    table: photos,
    folder: 'photos',
    load: (db: Db): MediaRow[] =>
      db
        .select({ r: photos, entryPurgedAt: entries.purgedAt })
        .from(photos)
        .leftJoin(entries, eq(entries.id, photos.entryId))
        .all()
        .map(({ r, entryPurgedAt }) => ({
          ...r,
          entryPurgedAt,
          paths: [r.originalPath, r.displayPath, r.thumbPath].filter(present),
        })),
  },
  {
    table: attachments,
    folder: 'attachments',
    load: (db: Db): MediaRow[] =>
      db
        .select({ r: attachments, entryPurgedAt: entries.purgedAt })
        .from(attachments)
        .leftJoin(entries, eq(entries.id, attachments.entryId))
        .all()
        .map(({ r, entryPurgedAt }) => ({
          ...r,
          entryPurgedAt,
          paths: [r.path].filter(present),
        })),
  },
] as const
