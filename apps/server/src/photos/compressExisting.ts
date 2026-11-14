import { readFile } from 'node:fs/promises'
import { existsSync, rmSync, statSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { and, eq, inArray, isNull, like } from 'drizzle-orm'
import type { CompressJob } from '@cairn/shared'
import type { Db } from '../db/index.ts'
import { photos } from '../db/schema.ts'
import { fileSizes } from '../storage/files.ts'
import { compressImage } from './pipeline.ts'
import { compressedPath } from './quality.ts'
import { storeOnce } from './storage.ts'

/** Compressing existing photos replaces files, so it needs a backup this recent. */
export const BACKUP_WITHIN_MS = 24 * 60 * 60 * 1000

const IDLE: CompressJob = {
  state: 'idle',
  startedAt: null,
  finishedAt: null,
  total: 0,
  done: 0,
  compressed: 0,
  savedBytes: 0,
  kept: 0,
  failed: 0,
  error: null,
}

/**
 * "Compress existing photos" (admins, server-wide; the job's state lives in memory, so a restart
 * just ends it and it can be run again). One original file at a time: compress it in memory,
 * then, with no await in between (so the media cleanup, which is synchronous, can't run in the
 * middle), write the JPEG, point every row that used the old file at it, and delete the old file.
 * Rows keep their `rev`: clients never hold originals, so there is nothing for them to sync.
 */
export function photoCompressor(db: Db, dataDir: string) {
  const root = resolve(dataDir)
  let job: CompressJob = IDLE

  /** Original JPEG and PNG files that live photos use, one entry per file. */
  const candidatePaths = () =>
    db
      .selectDistinct({ path: photos.originalPath })
      .from(photos)
      .where(
        and(
          isNull(photos.deletedAt),
          like(photos.originalPath, 'photos/%/originals/%'),
          inArray(photos.mime, ['image/jpeg', 'image/png']),
        ),
      )
      .all()
      .map((r) => r.path)

  async function compressOne(rel: string, now: number) {
    const userId = rel.split('/')[1]!
    const file = resolve(root, rel)
    if (!file.startsWith(`${resolve(root, 'photos', userId)}${sep}`)) return 'failed'
    let bytes: Buffer
    try {
      bytes = await readFile(file)
    } catch {
      return 'failed' // missing: the cleanup's report lists it
    }
    const small = await compressImage(bytes) // throws on an unreadable file: counted as failed
    if (!small) return 'kept'

    // From here on, synchronous.
    const row = db.select().from(photos).where(eq(photos.originalPath, rel)).get()
    if (!row || !existsSync(file)) return 'failed' // changed while compressing
    const target = compressedPath(userId, row.sha256)
    storeOnce(root, target, small)
    const size = statSync(resolve(root, target)).size
    db.update(photos)
      .set({ originalPath: target, mime: 'image/jpeg', bytes: size, updatedAt: now })
      .where(and(eq(photos.userId, userId), eq(photos.originalPath, rel)))
      .run()
    rmSync(file)
    job.savedBytes += Math.max(0, bytes.length - size)
    return 'compressed'
  }

  async function run(paths: string[]) {
    try {
      for (const rel of paths) {
        const result = await compressOne(rel, Date.now()).catch(() => 'failed' as const)
        job[result]++
        job.done++
      }
      job.state = 'done'
    } catch (e) {
      job.state = 'failed'
      job.error = (e as Error).message
    } finally {
      job.finishedAt = Date.now()
    }
  }

  return {
    status: (): CompressJob => ({ ...job }),

    async candidates() {
      const sizes = await fileSizes(root, candidatePaths())
      let bytes = 0
      for (const n of sizes.values()) bytes += n
      return { files: sizes.size, bytes }
    },

    /** Starts the job in the background; false if one is already running. */
    start(now = Date.now()) {
      if (job.state === 'running') return false
      const paths = candidatePaths()
      job = { ...IDLE, state: 'running', startedAt: now, total: paths.length }
      void run(paths)
      return true
    },
  }
}

export type PhotoCompressor = ReturnType<typeof photoCompressor>
