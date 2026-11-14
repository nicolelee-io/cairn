import { and, eq, inArray, isNull } from 'drizzle-orm'
import { attachmentRefs, photoRefs, stripAttachmentRef, stripPhotoRef } from '@cairn/shared'
import type { Db } from '../db/index.ts'
import { attachments, entries, photos } from '../db/schema.ts'
import { indexEntry } from '../search/index.ts'
import { nextRev } from './rev.ts'

// Photos and attachments behave the same way towards their entry: the body's references decide
// which rows belong to it and in what order. Only the table and the reference scheme differ.
type MediaTable = typeof photos | typeof attachments
const MEDIA = [
  { table: photos, refs: photoRefs, strip: stripPhotoRef },
  { table: attachments, refs: attachmentRefs, strip: stripAttachmentRef },
] as const
const schemeOf = (table: MediaTable) => MEDIA.find((m) => m.table === table)!

/**
 * Brings an entry's media rows in line with its body, inside the writing transaction: rows the
 * body now references that are still waiting for an entry (uploaded in the editor) are attached,
 * ones the edit removed from the text are tombstoned (files stay on disk), and positions follow
 * the order of appearance, so reordering is moving the line. Rows that were never referenced
 * (e.g. imported ones whose placeholder didn't survive) are left alone, after the rest.
 */
export function syncEntryMedia(
  tx: Db,
  userId: string,
  entryId: string,
  oldBody: string,
  newBody: string,
  now: number,
) {
  for (const { table, refs: refsOf } of MEDIA) {
    const t = table as typeof photos // same column names; see MediaTable
    const refs = refsOf(newBody)
    const live = () => and(eq(t.entryId, entryId), eq(t.userId, userId), isNull(t.deletedAt))

    if (refs.length) {
      const orphans = tx
        .select({ id: t.id })
        .from(t)
        .where(
          and(inArray(t.id, refs), eq(t.userId, userId), isNull(t.entryId), isNull(t.deletedAt)),
        )
        .all()
      for (const o of orphans) {
        tx.update(t)
          .set({ entryId, updatedAt: now, rev: nextRev(tx, userId) })
          .where(eq(t.id, o.id))
          .run()
      }
    }

    const removed = refsOf(oldBody).filter((id) => !refs.includes(id))
    for (const id of removed) {
      tx.update(t)
        .set({ deletedAt: now, updatedAt: now, rev: nextRev(tx, userId) })
        .where(and(eq(t.id, id), live()))
        .run()
    }

    const rows = tx
      .select({ id: t.id, position: t.position })
      .from(t)
      .where(live())
      .orderBy(t.position)
      .all()
    const referenced = refs.flatMap((id) => rows.filter((r) => r.id === id))
    const ordered = [...referenced, ...rows.filter((r) => !refs.includes(r.id))]
    ordered.forEach((r, position) => {
      if (r.position === position) return
      tx.update(t)
        .set({ position, updatedAt: now, rev: nextRev(tx, userId) })
        .where(eq(t.id, r.id))
        .run()
    })
  }
}

/**
 * Tombstones the named photos and attachments of this entry (files stay), skipping any the body
 * still references: for media the text never mentions, which can't be removed by editing the text.
 */
export function removeMedia(
  tx: Db,
  userId: string,
  entryId: string,
  ids: string[],
  body: string,
  now: number,
) {
  if (!ids.length) return
  for (const { table, refs } of MEDIA) {
    const t = table as typeof photos
    const referenced = refs(body)
    for (const id of ids.filter((i) => !referenced.includes(i))) {
      tx.update(t)
        .set({ deletedAt: now, updatedAt: now, rev: nextRev(tx, userId) })
        .where(and(eq(t.id, id), eq(t.entryId, entryId), eq(t.userId, userId), isNull(t.deletedAt)))
        .run()
    }
  }
}

/**
 * Tombstones one photo or attachment (files stay on disk). If it belongs to an entry, its
 * references are also removed from the body, so the text never points at a deleted file.
 * False if not found.
 */
export function removeOneMedia(
  db: Db,
  table: MediaTable,
  userId: string,
  id: string,
  now = Date.now(),
) {
  const t = table as typeof photos
  const { strip } = schemeOf(table)
  const mine = and(eq(t.id, id), eq(t.userId, userId), isNull(t.deletedAt))
  return db.transaction((tx) => {
    const row = tx.select({ entryId: t.entryId }).from(t).where(mine).get()
    if (!row) return false
    tx.update(t)
      .set({ deletedAt: now, updatedAt: now, rev: nextRev(tx, userId) })
      .where(mine)
      .run()
    if (row.entryId) {
      const entry = tx.select().from(entries).where(eq(entries.id, row.entryId)).get()
      if (entry && entry.userId === userId) {
        const bodyMd = strip(entry.bodyMd, id)
        if (bodyMd !== entry.bodyMd) {
          tx.update(entries)
            .set({ bodyMd, modifiedAt: now, updatedAt: now, rev: nextRev(tx, userId) })
            .where(eq(entries.id, entry.id))
            .run()
          indexEntry(tx, entry.id)
        }
      }
    }
    return true
  })
}
