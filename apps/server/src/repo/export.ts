import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Db } from '../db/index.ts'
import {
  attachments,
  entries,
  entryLocations,
  entryTags,
  entryWeather,
  journals,
  photos,
  tags,
} from '../db/schema.ts'

type Entry = typeof entries.$inferSelect
type Photo = typeof photos.$inferSelect
type Attachment = typeof attachments.$inferSelect

export interface ExportedEntry {
  entry: Entry
  location: typeof entryLocations.$inferSelect | null
  weather: typeof entryWeather.$inferSelect | null
  tags: string[]
  /** Live photos attached to the entry, in gallery order. */
  photos: Photo[]
  /** Live attachments, in order. */
  attachments: Attachment[]
}

/** The live photos and attachments of the exported entries, by entry id, in order. */
export interface ExportMedia {
  photos: Map<string, Photo[]>
  attachments: Map<string, Attachment[]>
}

function groupByEntry<T extends { entryId: string | null }>(rows: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const r of rows) {
    if (!r.entryId) continue // an upload nobody saved
    const list = out.get(r.entryId) ?? []
    list.push(r)
    out.set(r.entryId, list)
  }
  return out
}

/**
 * Everything one user owns that an export contains: live journals (archived ones included) with
 * their live entries, places, weather, tags, attached photos and attachments. Read-only, and like the other
 * repos every query is filtered by `userId` and excludes tombstones. Entries are read a batch at
 * a time (`entryIds`, then `entries`), so a big journal's text is never all in memory at once.
 */
export function exportRepo(db: Db, userId: string) {
  const liveEntries = (journalId?: string, entryId?: string) =>
    and(
      eq(entries.userId, userId),
      isNull(entries.deletedAt),
      journalId ? eq(entries.journalId, journalId) : undefined,
      entryId ? eq(entries.id, entryId) : undefined,
    )
  const liveJournal = and(
    eq(journals.id, entries.journalId),
    eq(journals.userId, userId),
    isNull(journals.deletedAt),
  )

  return {
    /** All live journals, or just `journalId` (empty if that isn't one of this user's). */
    journals(journalId?: string) {
      return db
        .select()
        .from(journals)
        .where(
          and(
            eq(journals.userId, userId),
            isNull(journals.deletedAt),
            journalId ? eq(journals.id, journalId) : undefined,
          ),
        )
        .orderBy(asc(journals.sortOrder), asc(journals.createdAt))
        .all()
    },

    /** One live entry of a live journal (archived included), for naming and scoping a single-entry export; undefined if it isn't this user's. */
    entryInfo(id: string) {
      return db
        .select({
          id: entries.id,
          journalId: entries.journalId,
          bodyMd: entries.bodyMd,
          createdAt: entries.createdAt,
          timezone: entries.timezone,
        })
        .from(entries)
        .innerJoin(journals, liveJournal)
        .where(liveEntries(undefined, id))
        .get()
    },

    /** Photos and attachments of the live entries (of `journalId`, else all; or just `entryId`), read up front to hash the files. */
    media(journalId?: string, entryId?: string): ExportMedia {
      return {
        photos: groupByEntry(
          db
            .select({ p: photos })
            .from(photos)
            .innerJoin(entries, eq(entries.id, photos.entryId))
            .innerJoin(journals, liveJournal)
            .where(
              and(
                eq(photos.userId, userId),
                isNull(photos.deletedAt),
                liveEntries(journalId, entryId),
              ),
            )
            .orderBy(asc(entries.createdAt), asc(entries.id), asc(photos.position), asc(photos.id))
            .all()
            .map((r) => r.p),
        ),
        attachments: groupByEntry(
          db
            .select({ a: attachments })
            .from(attachments)
            .innerJoin(entries, eq(entries.id, attachments.entryId))
            .innerJoin(journals, liveJournal)
            .where(
              and(
                eq(attachments.userId, userId),
                isNull(attachments.deletedAt),
                liveEntries(journalId, entryId),
              ),
            )
            .orderBy(
              asc(entries.createdAt),
              asc(entries.id),
              asc(attachments.position),
              asc(attachments.id),
            )
            .all()
            .map((r) => r.a),
        ),
      }
    },

    /** Ids of a journal's live entries, oldest first: fixed up front, so batches can't skip or repeat one. */
    entryIds(journalId: string, entryId?: string): string[] {
      return db
        .select({ id: entries.id })
        .from(entries)
        .where(liveEntries(journalId, entryId))
        .orderBy(asc(entries.createdAt), asc(entries.id))
        .all()
        .map((r) => r.id)
    },

    /**
     * These entries with their place, weather and tags, in the order of `ids`. One deleted since
     * `entryIds` is left out.
     */
    entries(ids: string[], media: ExportMedia): ExportedEntry[] {
      if (!ids.length) return []
      const rows = new Map(
        db
          .select()
          .from(entries)
          .where(
            and(
              inArray(entries.id, ids),
              // Unary + keeps SQLite off the user_id index: with a long IN list it would scan all of
              // the user's entries that way instead of looking each id up (~15x slower at 10k).
              sql`+${entries.userId} = ${userId}`,
              isNull(entries.deletedAt),
            ),
          )
          .all()
          .map((e) => [e.id, e]),
      )
      const locations = new Map(
        db
          .select()
          .from(entryLocations)
          .where(and(eq(entryLocations.userId, userId), inArray(entryLocations.entryId, ids)))
          .all()
          .map((l) => [l.entryId, l]),
      )
      const weathers = new Map(
        db
          .select()
          .from(entryWeather)
          .where(and(eq(entryWeather.userId, userId), inArray(entryWeather.entryId, ids)))
          .all()
          .map((w) => [w.entryId, w]),
      )
      const tagsByEntry = new Map<string, string[]>()
      for (const t of db
        .select({ entryId: entryTags.entryId, name: tags.name })
        .from(entryTags)
        .innerJoin(tags, eq(tags.id, entryTags.tagId))
        .where(
          and(
            eq(entryTags.userId, userId),
            isNull(tags.deletedAt),
            inArray(entryTags.entryId, ids),
          ),
        )
        .orderBy(asc(tags.name))
        .all()) {
        const list = tagsByEntry.get(t.entryId) ?? []
        list.push(t.name)
        tagsByEntry.set(t.entryId, list)
      }
      return ids.flatMap((id) => {
        const entry = rows.get(id)
        if (!entry) return []
        return [
          {
            entry,
            location: locations.get(id) ?? null,
            weather: weathers.get(id) ?? null,
            tags: tagsByEntry.get(id) ?? [],
            photos: media.photos.get(id) ?? [],
            attachments: media.attachments.get(id) ?? [],
          },
        ]
      })
    },
  }
}
