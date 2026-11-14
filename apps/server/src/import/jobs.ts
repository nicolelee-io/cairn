import { randomUUID } from 'node:crypto'
import { createWriteStream, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import {
  IMPORT_RESULT_MAX_LINES,
  type ImportJob,
  type ImportPreview,
  type ImportResult,
  type ImportStatus,
} from '@cairn/shared'
import { FileTooLargeError } from '../attachments/upload.ts'
import type { Db } from '../db/index.ts'
import { findUserById } from '../repo/users.ts'
import { ExportTooLargeError, previewDayOne, UnsupportedExportError } from './dayone/preview.ts'
import { importDayOne, type ImportReport } from './dayone/run.ts'
import { openZipSource, type ZipSource } from './dayone/source.ts'
import { attachmentLimit } from '../attachments/limit.ts'
import { MAX_UPLOAD_BYTES } from '../routes/photos.ts'

export { ExportTooLargeError, UnsupportedExportError } from './dayone/preview.ts'

/** This user already has an import running, or (on start) someone else does. */
export class ImportBusyError extends Error {}

/** An upload that isn't started within this is thrown away. */
export const STAGED_FOR_MS = 60 * 60 * 1000
/**
 * The journal files are parsed whole, so an upload whose JSON would unpack past this is refused
 * (a zip can be small and unpack huge). Real exports are far below it; the CLI has no limit.
 */
export const MAX_JSON_BYTES = 64 * 1024 * 1024
/**
 * Photos, videos and PDFs are compressed already, so a real export's media unpacks to about the
 * zip's own size. An upload whose other files would unpack past this many times the upload limit
 * is refused: it could only be there to fill the disk.
 */
export const MAX_MEDIA_RATIO = 2

/** Where uploads wait; nothing in it outlives the process (the state is in memory). */
const uploadsDir = (dataDir: string) => join(dataDir, 'imports')

/** At startup: uploads left by a run the last process didn't finish. */
export function clearImportUploads(dataDir: string) {
  rmSync(uploadsDir(dataDir), { recursive: true, force: true })
}

interface Staged {
  preview: ImportPreview
  userId: string
  file: string
  total: number
}

/**
 * Opens an upload as a zip, or throws UnsupportedExportError. A Day One export and Cairn's own
 * (Day One's format plus `cairn` extras) are read alike; `previewDayOne` checks the contents.
 */
async function openUpload(file: string): Promise<ZipSource> {
  try {
    return await openZipSource(file)
  } catch {
    throw new UnsupportedExportError('not a zip')
  }
}

/** The run's report as the app sees it: counts, and the first warnings and failures. */
function toResult(r: ImportReport): ImportResult {
  return {
    journals: r.journals,
    photosImported: r.photosImported,
    photosMissing: r.photosMissing,
    attachmentsImported: r.attachmentsImported,
    attachmentsMissing: r.attachmentsMissing,
    brokenPlaceholders: r.brokenPlaceholders,
    warnings: r.warnings.slice(0, IMPORT_RESULT_MAX_LINES),
    warningCount: r.warnings.length,
    failures: r.failures
      .slice(0, IMPORT_RESULT_MAX_LINES)
      .map((f) => ({ journal: f.journal, id: f.uuid, error: f.error })),
    failureCount: r.failures.length,
  }
}

/**
 * Imports from Settings (`routes/import.ts`). An upload is streamed to `imports/<id>.zip` (never
 * held in memory), opened, and previewed; starting it runs the importer in the background into
 * the uploader's own account, with the same rules as the CLI (idempotent on the Day One uuid, so
 * an interrupted run is finished by uploading the same zip again). One run at a time on the
 * server (photo processing is heavy). State lives in memory: a restart ends a run and drops
 * uploads (`clearImportUploads`).
 */
export function importJobs(db: Db, dataDir: string, now: () => number = Date.now) {
  const staged = new Map<string, Staged>()
  const jobs = new Map<string, ImportJob>()
  let current: { userId: string; done: Promise<void> } | null = null

  const drop = (id: string) => {
    const s = staged.get(id)
    if (!s) return
    rmSync(s.file, { force: true })
    staged.delete(id)
  }
  const expire = () => {
    for (const [id, s] of staged) if (s.preview.expiresAt <= now()) drop(id)
  }
  const stagedOf = (userId: string) => [...staged.values()].find((s) => s.userId === userId)

  async function upload(
    userId: string,
    body: ReadableStream<Uint8Array>,
    opts: { filename: string; maxBytes: number },
  ): Promise<ImportPreview> {
    expire()
    if (jobs.get(userId)?.state === 'running') throw new ImportBusyError()
    const previous = stagedOf(userId)
    if (previous) drop(previous.preview.id)

    const id = randomUUID()
    const dir = uploadsDir(dataDir)
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${id}.zip`)
    let bytes = 0
    const meter = new Transform({
      transform(chunk: Buffer, _enc, done) {
        bytes += chunk.length
        done(bytes > opts.maxBytes ? new FileTooLargeError() : null, chunk)
      },
    })
    try {
      await pipeline(
        Readable.fromWeb(body as WebReadableStream<Uint8Array>),
        meter,
        createWriteStream(file),
      )
      const source = await openUpload(file)
      try {
        const jsonBytes = source.journalFiles().reduce((n, f) => n + (source.fileSize(f) ?? 0), 0)
        if (source.unpackedBytes - jsonBytes > MAX_MEDIA_RATIO * opts.maxBytes)
          throw new ExportTooLargeError()
        const p = await previewDayOne(source, db, userId, { maxJsonBytes: MAX_JSON_BYTES })
        const preview: ImportPreview = {
          id,
          filename: opts.filename,
          bytes,
          expiresAt: now() + STAGED_FOR_MS,
          journals: p.journals,
          photos: p.photos,
          attachments: p.attachments,
        }
        staged.set(id, { preview, userId, file, total: p.total })
        return preview
      } finally {
        await source.close()
      }
    } catch (e) {
      rmSync(file, { force: true })
      throw e
    }
  }

  function status(userId: string): ImportStatus {
    expire()
    return {
      staged: stagedOf(userId)?.preview ?? null,
      job: jobs.get(userId) ?? null,
      busy: !!current && current.userId !== userId,
    }
  }

  /** False when there is no such upload of this user's. */
  function cancel(userId: string, id: string): boolean {
    expire()
    if (staged.get(id)?.userId !== userId) return false
    drop(id)
    return true
  }

  /** Null when there is no such upload of this user's; throws ImportBusyError while one runs. */
  function start(userId: string, id: string, archived: string[]): ImportJob | null {
    expire()
    const s = staged.get(id)
    if (!s || s.userId !== userId) return null
    if (current) throw new ImportBusyError()
    staged.delete(id) // the run owns the file now and removes it when it ends

    const job: ImportJob = {
      state: 'running',
      filename: s.preview.filename,
      startedAt: now(),
      finishedAt: null,
      total: s.total,
      done: 0,
      report: null,
      error: null,
    }
    jobs.set(userId, job)
    const timezone = findUserById(db, userId)?.defaultTimezone ?? 'UTC'
    // Progress comes per journal; add up the journals already finished.
    let journal: string | null = null
    let before = 0
    let inJournal = 0

    const run = async () => {
      const source = await openUpload(s.file)
      try {
        const report = await importDayOne({
          source,
          db,
          dataDir,
          userId,
          defaultTimezone: timezone,
          archived,
          // The same limits as uploading the files one by one.
          maxPhotoBytes: MAX_UPLOAD_BYTES,
          maxAttachmentBytes: attachmentLimit(db).mb() * 1024 * 1024,
          onProgress: (done, _total, name) => {
            if (name !== journal) {
              before += inJournal
              journal = name
            }
            inJournal = done
            job.done = before + done
          },
        })
        job.report = toResult(report)
        job.state = 'done'
      } finally {
        await source.close()
      }
    }
    const done = run()
      .catch((e: unknown) => {
        console.error('import failed', e)
        job.state = 'failed'
        // The details stay in the server log; the app gets a line fit to show.
        job.error =
          (e as NodeJS.ErrnoException).code === 'ENOSPC'
            ? 'The server’s disk is full.'
            : 'Something went wrong on the server. Its log has the details.'
      })
      .finally(() => {
        job.finishedAt = now()
        rmSync(s.file, { force: true })
        current = null
      })
    current = { userId, done }
    return job
  }

  return {
    upload,
    status,
    cancel,
    start,
    /** Resolves when the running import (if any) has finished; for tests. */
    settled: () => current?.done ?? Promise.resolve(),
  }
}

export type ImportJobs = ReturnType<typeof importJobs>
