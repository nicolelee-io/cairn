import { and, eq, isNull } from 'drizzle-orm'
import type { Db } from '../db/index.ts'
import { photos } from '../db/schema.ts'
import { removeOneMedia } from './media.ts'
import { nextRev } from './rev.ts'

export type UploadedPhoto = Pick<
  typeof photos.$inferInsert,
  | 'id'
  | 'originalPath'
  | 'displayPath'
  | 'thumbPath'
  | 'mime'
  | 'width'
  | 'height'
  | 'bytes'
  | 'sha256'
  | 'takenAt'
  | 'latitude'
  | 'longitude'
>

/** Every query here is filtered by `userId` and excludes tombstones. */
export function photoRepo(db: Db, userId: string) {
  const mine = (id: string) =>
    and(eq(photos.id, id), eq(photos.userId, userId), isNull(photos.deletedAt))
  return {
    get(id: string) {
      return db.select().from(photos).where(mine(id)).get()
    },
    listForEntry(entryId: string) {
      return db
        .select()
        .from(photos)
        .where(
          and(eq(photos.entryId, entryId), eq(photos.userId, userId), isNull(photos.deletedAt)),
        )
        .orderBy(photos.position)
        .all()
    },

    /** Records an upload. It has no entry until the entry that references it is saved. */
    add(input: UploadedPhoto, now = Date.now()) {
      return db.transaction((tx) =>
        tx
          .insert(photos)
          .values({
            ...input,
            userId,
            entryId: null,
            position: 0,
            createdAt: now,
            updatedAt: now,
            rev: nextRev(tx, userId),
          })
          .returning()
          .get(),
      )
    },

    /** Tombstones a photo and strips its references from its entry's text. False if not found. */
    remove: (id: string, now = Date.now()) => removeOneMedia(db, photos, userId, id, now),
  }
}
