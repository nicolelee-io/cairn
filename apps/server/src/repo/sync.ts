import { and, asc, eq, gt, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
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
  users,
} from '../db/schema.ts'

/** What changed for this user after a revision (SPEC 4d). Every query is filtered by `userId`. */
export interface SyncPage {
  cursor: number
  hasMore: boolean
  reset: boolean
  journals: (typeof journals.$inferSelect)[]
  deletedJournalIds: string[]
  entries: {
    entry: typeof entries.$inferSelect
    location: typeof entryLocations.$inferSelect | null
    weather: typeof entryWeather.$inferSelect | null
    tags: string[]
  }[]
  deletedEntryIds: string[]
  photos: (typeof photos.$inferSelect & { entryId: string })[]
  deletedPhotoIds: string[]
  attachments: (typeof attachments.$inferSelect & { entryId: string })[]
  deletedAttachmentIds: string[]
}

// An entry's feed position: its own rev, or the later one a background weather fetch stamped.
const entryRev = sql<number>`max(${entries.rev}, coalesce(${entries.weatherRev}, 0))`

type Candidate =
  | { rev: number; kind: 'journal'; row: typeof journals.$inferSelect }
  | { rev: number; kind: 'entry'; row: typeof entries.$inferSelect }
  | { rev: number; kind: 'photo'; row: typeof photos.$inferSelect & { journalId: string } }
  | {
      rev: number
      kind: 'attachment'
      row: typeof attachments.$inferSelect & { journalId: string }
    }

export function syncRepo(db: Db, userId: string) {
  return {
    /** Per journal: live entries, their text size, and the photo files a copy would need. */
    estimate() {
      const live = and(eq(entries.userId, userId), isNull(entries.deletedAt))
      const text = db
        .select({
          journalId: entries.journalId,
          entries: sql<number>`count(*)`,
          textBytes: sql<number>`coalesce(sum(length(cast(${entries.bodyMd} as blob))), 0)`,
        })
        .from(entries)
        .where(live)
        .groupBy(entries.journalId)
        .all()
      const files = db
        .select({
          journalId: entries.journalId,
          displayPath: photos.displayPath,
          thumbPath: photos.thumbPath,
        })
        .from(photos)
        .innerJoin(entries, eq(entries.id, photos.entryId))
        .where(and(live, eq(photos.userId, userId), isNull(photos.deletedAt)))
        .all()
      return { text, files }
    },

    /**
     * Up to `limit` changes in revision order across the four tables. Each table is asked for
     * `limit` rows, so the merged page can't skip a lower revision held back by a table's own cap.
     */
    changes(opts: { since: number; limit: number; journalIds?: string[] }): SyncPage {
      const { since, limit } = opts
      const wanted = opts.journalIds ? new Set(opts.journalIds) : null
      return db.transaction((tx) => {
        const user = tx
          .select({ lastRev: users.lastRev })
          .from(users)
          .where(eq(users.id, userId))
          .get()
        const lastRev = user?.lastRev ?? 0
        const empty: SyncPage = {
          cursor: 0,
          hasMore: false,
          reset: false,
          journals: [],
          deletedJournalIds: [],
          entries: [],
          deletedEntryIds: [],
          photos: [],
          deletedPhotoIds: [],
          attachments: [],
          deletedAttachmentIds: [],
        }
        // The client has seen revisions this database never issued: it was restored from a backup.
        if (since > lastRev) return { ...empty, reset: true, hasMore: true }

        const js = tx
          .select()
          .from(journals)
          .where(and(eq(journals.userId, userId), gt(journals.rev, since)))
          .orderBy(asc(journals.rev))
          .limit(limit)
          .all()
        // From the start only the wanted journals' entries matter; later, a change elsewhere is
        // still reported (as deleted) in case the entry used to be in a wanted journal.
        const scopeAtStart =
          since === 0 && wanted ? inArray(entries.journalId, [...wanted]) : undefined
        const es = tx
          .select()
          .from(entries)
          .where(and(eq(entries.userId, userId), sql`${entryRev} > ${since}`, scopeAtStart))
          .orderBy(asc(entryRev))
          .limit(limit)
          .all()
        const ps = tx
          .select({ photo: photos, journalId: entries.journalId })
          .from(photos)
          .innerJoin(entries, eq(entries.id, photos.entryId))
          .where(
            and(
              eq(photos.userId, userId),
              isNotNull(photos.entryId),
              gt(photos.rev, since),
              since === 0 && wanted ? inArray(entries.journalId, [...wanted]) : undefined,
            ),
          )
          .orderBy(asc(photos.rev))
          .limit(limit)
          .all()
        const as = tx
          .select({ attachment: attachments, journalId: entries.journalId })
          .from(attachments)
          .innerJoin(entries, eq(entries.id, attachments.entryId))
          .where(
            and(
              eq(attachments.userId, userId),
              isNotNull(attachments.entryId),
              gt(attachments.rev, since),
              since === 0 && wanted ? inArray(entries.journalId, [...wanted]) : undefined,
            ),
          )
          .orderBy(asc(attachments.rev))
          .limit(limit)
          .all()

        const merged: Candidate[] = [
          ...js.map((row): Candidate => ({ rev: row.rev, kind: 'journal', row })),
          ...es.map((row): Candidate => ({
            rev: Math.max(row.rev, row.weatherRev ?? 0),
            kind: 'entry',
            row,
          })),
          ...ps.map((p): Candidate => ({
            rev: p.photo.rev,
            kind: 'photo',
            row: { ...p.photo, journalId: p.journalId },
          })),
          ...as.map((a): Candidate => ({
            rev: a.attachment.rev,
            kind: 'attachment',
            row: { ...a.attachment, journalId: a.journalId },
          })),
        ].sort((a, b) => a.rev - b.rev)
        const page = merged.slice(0, limit)
        const hasMore =
          merged.length > limit || [js, es, ps, as].some((rows) => rows.length >= limit)
        const lastRow = page[page.length - 1]
        const out: SyncPage = {
          ...empty,
          hasMore,
          // Caught up: skip ahead to the present, so the next poll doesn't rescan this stretch.
          cursor: hasMore || !lastRow ? (lastRow?.rev ?? since) : lastRev,
        }

        const inScope = (journalId: string) => !wanted || wanted.has(journalId)
        const liveEntries: (typeof entries.$inferSelect)[] = []
        for (const c of page) {
          if (c.kind === 'journal') {
            if (c.row.deletedAt) out.deletedJournalIds.push(c.row.id)
            else out.journals.push(c.row)
          } else if (c.kind === 'entry') {
            if (c.row.deletedAt || !inScope(c.row.journalId)) out.deletedEntryIds.push(c.row.id)
            else liveEntries.push(c.row)
          } else if (c.kind === 'photo') {
            if (c.row.deletedAt || !inScope(c.row.journalId)) out.deletedPhotoIds.push(c.row.id)
            else out.photos.push({ ...c.row, entryId: c.row.entryId! })
          } else if (c.row.deletedAt || !inScope(c.row.journalId)) {
            out.deletedAttachmentIds.push(c.row.id)
          } else {
            out.attachments.push({ ...c.row, entryId: c.row.entryId! })
          }
        }

        if (liveEntries.length) {
          const ids = liveEntries.map((e) => e.id)
          const locs = tx
            .select()
            .from(entryLocations)
            .where(and(inArray(entryLocations.entryId, ids), eq(entryLocations.userId, userId)))
            .all()
          const wxs = tx
            .select()
            .from(entryWeather)
            .where(and(inArray(entryWeather.entryId, ids), eq(entryWeather.userId, userId)))
            .all()
          const tagRows = tx
            .select({ entryId: entryTags.entryId, name: tags.name })
            .from(entryTags)
            .innerJoin(tags, eq(tags.id, entryTags.tagId))
            .where(
              and(
                inArray(entryTags.entryId, ids),
                eq(tags.userId, userId),
                sql`${tags.deletedAt} is null`,
              ),
            )
            .orderBy(sql`lower(${tags.name})`)
            .all()
          for (const entry of liveEntries) {
            out.entries.push({
              entry,
              location: locs.find((l) => l.entryId === entry.id) ?? null,
              weather: wxs.find((w) => w.entryId === entry.id) ?? null,
              tags: tagRows.filter((t) => t.entryId === entry.id).map((t) => t.name),
            })
          }
        }
        return out
      })
    },
  }
}
