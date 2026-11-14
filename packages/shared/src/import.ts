import { z } from 'zod'

// Importing an export from Settings > Your data (`/api/import`). What it reads is Day One's JSON
// zip, which is also Cairn's own export (the same format with `cairn` extras); the API is about
// importing, not about Day One.

const nat = z.number().int().min(0)

/** One journal in an uploaded export, before anything is written. */
export const ImportPreviewJournalSchema = z.object({
  name: z.string(),
  entries: nat,
  /** Entries already here (imported before, or still in the trash): they are skipped. */
  alreadyImported: nat,
  /** A journal of this name exists, so entries go into it and its settings stay. */
  exists: z.boolean(),
  /** That existing journal is archived (or the export says this one is). */
  archived: z.boolean(),
})

/** PUT /api/import (the raw zip): what the upload holds. Start it or cancel it by `id`. */
export const ImportPreviewSchema = z.object({
  id: z.string(),
  /** The uploaded file's name, as sent. */
  filename: z.string(),
  bytes: nat,
  /** When the upload is thrown away if it isn't started. */
  expiresAt: z.number(),
  journals: z.array(ImportPreviewJournalSchema),
  photos: nat,
  attachments: nat,
})
export type ImportPreview = z.infer<typeof ImportPreviewSchema>

/** POST /api/import/:id/start. Journal names to import as archived (the CLI's `--archived`). */
export const StartImportSchema = z.object({ archived: z.array(z.string()).max(1000).default([]) })

/** Warnings and failures are capped in the reply; the counts say how many there were. */
export const IMPORT_RESULT_MAX_LINES = 50

export const ImportResultSchema = z.object({
  journals: z.array(
    z.object({
      name: z.string(),
      archived: z.boolean(),
      total: nat,
      imported: nat,
      skipped: nat,
      failed: nat,
    }),
  ),
  photosImported: nat,
  photosMissing: nat,
  attachmentsImported: nat,
  attachmentsMissing: nat,
  brokenPlaceholders: nat,
  warnings: z.array(z.string()),
  warningCount: nat,
  failures: z.array(z.object({ journal: z.string(), id: z.string(), error: z.string() })),
  failureCount: nat,
})
export type ImportResult = z.infer<typeof ImportResultSchema>

/** The signed-in user's latest import run (kept in the server's memory until it restarts). */
export const ImportJobSchema = z.object({
  state: z.enum(['running', 'done', 'failed']),
  filename: z.string(),
  startedAt: z.number(),
  finishedAt: z.number().nullable(),
  /** Entries in the export, and how many have been looked at. */
  total: nat,
  done: nat,
  /** Set once the run has finished. */
  report: ImportResultSchema.nullable(),
  /** Why a failed run stopped. Entries written before it stay. */
  error: z.string().nullable(),
})
export type ImportJob = z.infer<typeof ImportJobSchema>

/** GET /api/import: an upload waiting to be started, and the latest run. */
export const ImportStatusSchema = z.object({
  staged: ImportPreviewSchema.nullable(),
  job: ImportJobSchema.nullable(),
  /** Another account's import is running; only one runs at a time on the server. */
  busy: z.boolean(),
})
export type ImportStatus = z.infer<typeof ImportStatusSchema>
