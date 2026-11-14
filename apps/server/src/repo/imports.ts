import { and, eq, isNotNull, isNull, or } from 'drizzle-orm'
import type { MoodKey } from '@cairn/shared'
import { uuidv7 } from '@cairn/shared'
import type { Db } from '../db/index.ts'
import {
  attachments,
  entries,
  entryLocations,
  entryTags,
  entryWeather,
  journals,
  photos,
} from '../db/schema.ts'
import { indexEntry } from '../search/index.ts'
import { nextRev } from './rev.ts'
import { resolveTags } from './tags.ts'

export type NewLocation = Omit<typeof entryLocations.$inferInsert, 'entryId' | 'userId'>
export type NewWeather = Omit<typeof entryWeather.$inferInsert, 'entryId' | 'userId'>
export type NewPhoto = Omit<
  typeof photos.$inferInsert,
  'userId' | 'entryId' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'rev'
>

export type NewAttachment = Omit<
  typeof attachments.$inferInsert,
  'userId' | 'entryId' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'rev'
>

export interface ImportedEntry {
  sourceId: string
  journalId: string
  bodyMd: string
  createdAt: number
  modifiedAt: number
  timezone: string
  starred: boolean
  pinned: boolean
  allDay: boolean
  creationDevice: string | null
  /** 'native' for an entry written in Cairn (restored from a Cairn export); else Day One's. */
  source?: 'native' | 'dayone'
  /** The entry's id in the Cairn it was exported from; the same entry isn't imported twice. */
  cairnId?: string | null
  mood?: MoodKey | null
  moodSuggested?: number | null
  moodSuggestedBy?: string | null
  sourceRaw: string | null
  tags: string[]
  location: NewLocation | null
  weather: NewWeather | null
  photos: NewPhoto[]
  attachments?: NewAttachment[]
}

/**
 * Writes imported entries. Like the other repos, everything is scoped to `userId`; each entry is
 * one transaction, so a failure leaves no half-imported entry behind.
 */
export function importRepo(db: Db, userId: string) {
  /**
   * This user's entry an import of `sourceId` would duplicate: by Day One uuid or (for our own
   * export) by the Cairn id it came from. With `reimportPurged`, an entry emptied from the trash
   * doesn't count (only the importer's `--force` asks for that).
   */
  const existing = (
    sourceId: string,
    cairnId: string | null | undefined,
    reimportPurged: boolean,
  ) =>
    and(
      eq(entries.userId, userId),
      or(eq(entries.sourceId, sourceId), cairnId ? eq(entries.id, cairnId) : undefined),
      reimportPurged ? isNull(entries.purgedAt) : undefined,
    )

  return {
    /** Already here (see `existing`). */
    hasSource(sourceId: string, cairnId?: string | null, { reimportPurged = false } = {}): boolean {
      return !!db
        .select({ id: entries.id })
        .from(entries)
        .where(existing(sourceId, cairnId, reimportPurged))
        .get()
    },

    newMediaId: (at: number) => uuidv7(at),

    /**
     * Idempotent on (user, source_id): an already-imported entry is left alone, edits included.
     * `reimportPurged` imports a fresh copy of one that was emptied from the trash: the scrubbed
     * tombstone stays for sync but gives up its `source_id` (the unique index allows one).
     */
    importEntry(
      input: ImportedEntry,
      now = Date.now(),
      { reimportPurged = false } = {},
    ): 'imported' | 'skipped' {
      return db.transaction((tx) => {
        const exists = tx
          .select({ id: entries.id })
          .from(entries)
          .where(existing(input.sourceId, input.cairnId, reimportPurged))
          .get()
        if (exists) return 'skipped'
        if (reimportPurged)
          tx.update(entries)
            .set({ sourceId: null })
            .where(
              and(
                eq(entries.userId, userId),
                eq(entries.sourceId, input.sourceId),
                isNotNull(entries.purgedAt),
              ),
            )
            .run()

        const own = tx
          .select({ id: journals.id })
          .from(journals)
          .where(
            and(
              eq(journals.id, input.journalId),
              eq(journals.userId, userId),
              isNull(journals.deletedAt),
            ),
          )
          .get()
        if (!own) throw new Error('journal not found')

        const entryId = uuidv7(input.createdAt)
        tx.insert(entries)
          .values({
            id: entryId,
            sourceId: input.sourceId,
            userId,
            journalId: input.journalId,
            bodyMd: input.bodyMd,
            createdAt: input.createdAt,
            modifiedAt: input.modifiedAt,
            timezone: input.timezone,
            starred: input.starred,
            pinned: input.pinned,
            allDay: input.allDay,
            creationDevice: input.creationDevice,
            moodKey: input.mood ?? null,
            moodSuggested: input.moodSuggested ?? null,
            moodSuggestedBy: input.moodSuggestedBy ?? null,
            source: input.source ?? 'dayone',
            sourceRaw: input.sourceRaw,
            updatedAt: now,
            rev: nextRev(tx, userId),
          })
          .run()

        if (input.location)
          tx.insert(entryLocations)
            .values({ ...input.location, entryId, userId })
            .run()
        if (input.weather)
          tx.insert(entryWeather)
            .values({ ...input.weather, entryId, userId })
            .run()

        for (const tagId of resolveTags(
          tx,
          userId,
          input.tags.map((t) => t.trim()).filter(Boolean),
          now,
        )) {
          tx.insert(entryTags).values({ entryId, tagId, userId }).run()
        }
        for (const p of input.photos) {
          tx.insert(photos)
            .values({
              ...p,
              userId,
              entryId,
              createdAt: now,
              updatedAt: now,
              rev: nextRev(tx, userId),
            })
            .run()
        }
        for (const a of input.attachments ?? []) {
          tx.insert(attachments)
            .values({
              ...a,
              userId,
              entryId,
              createdAt: now,
              updatedAt: now,
              rev: nextRev(tx, userId),
            })
            .run()
        }
        indexEntry(tx, entryId, { fresh: true })
        return 'imported'
      })
    },
  }
}
