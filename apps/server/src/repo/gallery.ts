import { and, desc, eq, inArray, isNull, lt, or, type AnyColumn } from 'drizzle-orm'
import {
  ATTACHMENT_KINDS,
  decodeCursor,
  encodeCursor,
  type MediaItem,
  type MediaKind,
} from '@cairn/shared'
import type { Db } from '../db/index.ts'
import { attachments, entries, journals, photos } from '../db/schema.ts'

/**
 * The Media view's feed: photos and files that belong to a live entry, newest entry first. Photos
 * and attachments are two tables, so each is read up to `limit + 1` rows past the cursor and the
 * two are merged; ids are unique across both, so (entry time, id) is a total order for the cursor.
 */
export function galleryRepo(db: Db, userId: string) {
  return {
    page({
      journalId,
      kinds,
      cursor,
      limit = 40,
    }: {
      journalId?: string
      /** Only these kinds; all when omitted. */
      kinds?: MediaKind[]
      cursor?: string
      limit?: number
    } = {}): { items: MediaItem[]; nextCursor: string | null } {
      const after = cursor ? decodeCursor(cursor) : null
      if (cursor && !after) throw new Error('bad cursor')
      const want = (k: MediaKind) => !kinds || kinds.includes(k)

      // Archived journals are left out unless one is named, like the timeline.
      const inScope = and(
        eq(entries.userId, userId),
        isNull(entries.deletedAt),
        journalId ? eq(entries.journalId, journalId) : isNull(journals.archivedAt),
      )
      // Past the cursor: an older entry, or the same time with a smaller media id.
      const pastCursor = (mediaId: AnyColumn) =>
        after
          ? or(
              lt(entries.createdAt, after.createdAt),
              and(eq(entries.createdAt, after.createdAt), lt(mediaId, after.id)),
            )
          : undefined
      const journalJoin = and(
        eq(journals.id, entries.journalId),
        eq(journals.userId, userId),
        isNull(journals.deletedAt),
      )
      const entryFields = {
        entryId: entries.id,
        journalId: entries.journalId,
        createdAt: entries.createdAt,
        timezone: entries.timezone,
      }

      const found: MediaItem[] = []
      if (want('photo')) {
        const rows = db
          .select({ id: photos.id, ...entryFields })
          .from(photos)
          .innerJoin(entries, eq(entries.id, photos.entryId))
          .innerJoin(journals, journalJoin)
          .where(
            and(
              eq(photos.userId, userId),
              isNull(photos.deletedAt),
              inScope,
              pastCursor(photos.id),
            ),
          )
          .orderBy(desc(entries.createdAt), desc(photos.id))
          .limit(limit + 1)
          .all()
        for (const r of rows) found.push({ ...r, kind: 'photo', filename: null })
      }
      const files = ATTACHMENT_KINDS.filter(want)
      if (files.length) {
        const rows = db
          .select({
            id: attachments.id,
            kind: attachments.kind,
            filename: attachments.filename,
            ...entryFields,
          })
          .from(attachments)
          .innerJoin(entries, eq(entries.id, attachments.entryId))
          .innerJoin(journals, journalJoin)
          .where(
            and(
              eq(attachments.userId, userId),
              isNull(attachments.deletedAt),
              inArray(attachments.kind, files),
              inScope,
              pastCursor(attachments.id),
            ),
          )
          .orderBy(desc(entries.createdAt), desc(attachments.id))
          .limit(limit + 1)
          .all()
        for (const r of rows) found.push(r)
      }

      found.sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1))
      const page = found.slice(0, limit)
      const last = page[page.length - 1]
      return {
        items: page,
        nextCursor: found.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
      }
    },
  }
}
