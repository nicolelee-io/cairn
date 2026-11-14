import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import type { Db } from '../db/index.ts'
import { attachments, entries, journals, photos } from '../db/schema.ts'

/**
 * What a user's data takes: the rows only; `storage/usage.ts` measures the files. Media rows come
 * in every state (live, deleted, never attached, in a deleted entry), since a file stays on disk
 * until the cleanup removes it; `live` says whether a live entry still shows it, `trashed` whether
 * an entry in the trash does.
 */
export function storageRepo(db: Db, userId: string) {
  // A photo or attachment is shown when it and its entry are live (a deleted journal's entries
  // are tombstoned with it).
  const shown = (t: typeof photos | typeof attachments) =>
    sql<number>`(${t.deletedAt} IS NULL AND ${entries.id} IS NOT NULL AND ${entries.deletedAt} IS NULL)`
  // Media of an entry in the trash stay live until the entry is purged (repo/trash.ts).
  const inTrash = (t: typeof photos | typeof attachments) =>
    sql<number>`(${t.deletedAt} IS NULL AND ${entries.deletedAt} IS NOT NULL AND ${entries.purgedAt} IS NULL)`

  return {
    /** Entries in the trash (with their journal or on their own) and their text bytes. */
    trashText() {
      return (
        db
          .select({
            entries: sql<number>`count(*)`,
            textBytes: sql<number>`coalesce(sum(length(cast(${entries.bodyMd} as blob))), 0)`,
          })
          .from(entries)
          .where(
            and(eq(entries.userId, userId), isNotNull(entries.deletedAt), isNull(entries.purgedAt)),
          )
          .get() ?? { entries: 0, textBytes: 0 }
      )
    },

    /** Live journals, archived ones included, with their live entries' count and text bytes. */
    journals() {
      return db
        .select({
          journalId: journals.id,
          entries: sql<number>`count(${entries.id})`,
          textBytes: sql<number>`coalesce(sum(length(cast(${entries.bodyMd} as blob))), 0)`,
        })
        .from(journals)
        .leftJoin(
          entries,
          and(
            eq(entries.journalId, journals.id),
            eq(entries.userId, userId),
            isNull(entries.deletedAt),
          ),
        )
        .where(and(eq(journals.userId, userId), isNull(journals.deletedAt)))
        .groupBy(journals.id)
        .all()
    },

    photoFiles() {
      return db
        .select({
          journalId: entries.journalId,
          live: shown(photos),
          trashed: inTrash(photos),
          originalPath: photos.originalPath,
          displayPath: photos.displayPath,
          thumbPath: photos.thumbPath,
        })
        .from(photos)
        .leftJoin(entries, and(eq(entries.id, photos.entryId), eq(entries.userId, userId)))
        .where(eq(photos.userId, userId))
        .all()
    },

    attachmentFiles() {
      return db
        .select({
          journalId: entries.journalId,
          live: shown(attachments),
          trashed: inTrash(attachments),
          kind: attachments.kind,
          path: attachments.path,
        })
        .from(attachments)
        .leftJoin(entries, and(eq(entries.id, attachments.entryId), eq(entries.userId, userId)))
        .where(eq(attachments.userId, userId))
        .all()
    },
  }
}
