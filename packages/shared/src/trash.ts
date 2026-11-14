import { z } from 'zod'
import { EntryDetailSchema, TimelineItemSchema } from './api.ts'

// Deleted entries and journals sit in the trash (deleted_at set, purged_at null) for the server's
// retention, then are purged: scrubbed, with the tombstone kept for sync.

/** How long the trash keeps things (a server setting, admins only). */
export const TRASH_RETENTION_DAYS = [7, 14, 30, 60, 90, 180, 365] as const
export const DEFAULT_TRASH_RETENTION_DAYS = 60
export const TrashRetentionDaysSchema = z
  .number()
  .int()
  .refine((d) => (TRASH_RETENTION_DAYS as readonly number[]).includes(d), 'not an allowed choice')

/** GET/PUT /api/admin/trash. */
export const TrashSettingsSchema = z.object({ retentionDays: TrashRetentionDaysSchema })
export type TrashSettings = z.infer<typeof TrashSettingsSchema>

/** An entry card in the trash: the timeline card plus when it was deleted and when it goes for good. */
export const TrashEntrySchema = TimelineItemSchema.extend({
  deletedAt: z.number(),
  purgeAt: z.number(),
})
export type TrashEntry = z.infer<typeof TrashEntrySchema>

/** GET /api/trash/entries/:id: a trashed entry in full, to read before restoring it. */
export const TrashEntryDetailSchema = EntryDetailSchema.extend({
  deletedAt: z.number(),
  purgeAt: z.number(),
})
export type TrashEntryDetail = z.infer<typeof TrashEntryDetailSchema>

/** GET /api/trash/entries: entries whose journal is live, most recently deleted first. */
export const TrashEntriesPageSchema = z.object({
  items: z.array(TrashEntrySchema),
  nextCursor: z.string().nullable(),
})
export type TrashEntriesPage = z.infer<typeof TrashEntriesPageSchema>

export const TrashJournalSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().nullable(),
  icon: z.string().nullable(),
  deletedAt: z.number(),
  purgeAt: z.number(),
  /** The entries deleted with it, which a restore brings back. */
  entryCount: z.number(),
})
export type TrashJournal = z.infer<typeof TrashJournalSchema>

/** GET /api/trash/journals. */
export const TrashJournalsSchema = z.object({ journals: z.array(TrashJournalSchema) })

/** GET /api/trash/count: what the Trash page would list. */
export const TrashCountSchema = z.object({ entries: z.number(), journals: z.number() })
export type TrashCount = z.infer<typeof TrashCountSchema>

/** POST /api/trash/entries/:id/restore. (A restored journal is a `Journal`.) */
export const TrashRestoredEntrySchema = z.object({ id: z.string(), journalId: z.string() })
export type TrashRestoredEntry = z.infer<typeof TrashRestoredEntrySchema>

/** DELETE /api/trash (empty) and the expiry run: how many were purged. */
export const TrashPurgedSchema = z.object({ entries: z.number(), journals: z.number() })
export type TrashPurged = z.infer<typeof TrashPurgedSchema>

/** When something deleted at `deletedAt` leaves the trash. */
export const trashPurgeAt = (deletedAt: number, retentionDays: number) =>
  deletedAt + retentionDays * 24 * 60 * 60 * 1000
