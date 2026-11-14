import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type PhotoKind = 'originals' | 'compressed' | 'display' | 'thumb'

/** Data-dir-relative path (what the DB stores). Content-addressed by the original's sha256. */
export const photoPath = (userId: string, kind: PhotoKind, sha256: string, ext: string) =>
  `photos/${userId}/${kind}/${sha256}.${ext}`

/**
 * An existing file is already right (same hash), so skip it, but mark it fresh: the cleanup
 * leaves a file no row names alone for a day, and this upload's row comes after. Temp + rename
 * avoids torn files.
 */
export function storeOnce(dataDir: string, relPath: string, bytes: Buffer) {
  const path = join(dataDir, relPath)
  if (existsSync(path)) return touch(path)
  mkdirSync(dirname(path), { recursive: true })
  // A unique temp name: two uploads of the same bytes at once must not write the same file.
  const tmp = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(tmp, bytes)
    renameSync(tmp, path)
  } catch (e) {
    rmSync(tmp, { force: true })
    throw e
  }
}

/** Sets a file's mtime to now (see `storeOnce`). */
export function touch(path: string) {
  const now = new Date()
  utimesSync(path, now, now)
}
