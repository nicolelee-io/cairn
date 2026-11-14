import { and, eq, isNull } from 'drizzle-orm'
import type { Db } from '../db/index.ts'
import { attachments } from '../db/schema.ts'
import { removeOneMedia } from './media.ts'
import { nextRev } from './rev.ts'

export type UploadedAttachment = Pick<
  typeof attachments.$inferInsert,
  'id' | 'kind' | 'path' | 'mime' | 'bytes' | 'sha256' | 'filename'
>

/** Every query here is filtered by `userId` and excludes tombstones. */
export function attachmentRepo(db: Db, userId: string) {
  const mine = (id: string) =>
    and(eq(attachments.id, id), eq(attachments.userId, userId), isNull(attachments.deletedAt))
  return {
    get(id: string) {
      return db.select().from(attachments).where(mine(id)).get()
    },

    /** Records an upload. It has no entry until the entry that references it is saved. */
    add(input: UploadedAttachment, now = Date.now()) {
      return db.transaction((tx) =>
        tx
          .insert(attachments)
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

    /** Tombstones an attachment and strips its references from its entry's text. False if not found. */
    remove: (id: string, now = Date.now()) => removeOneMedia(db, attachments, userId, id, now),
  }
}
