import { and, eq, inArray, isNull, notExists, sql } from 'drizzle-orm'
import { tagKey, uuidv7, type TagChange, type TagCount } from '@cairn/shared'
import type { Db } from '../db/index.ts'
import { entries, entryTags, tags } from '../db/schema.ts'
import { indexEntry } from '../search/index.ts'
import { nextRev } from './rev.ts'

/**
 * The ids of the user's tags for these names, creating the missing ones. Names match ignoring case
 * and the first spelling stays, so "travel" finds an existing "Travel". Call inside the writing
 * transaction. Duplicates in `names` (by that rule) collapse to one id.
 */
export function resolveTags(tx: Db, userId: string, names: string[], now: number): string[] {
  const byKey = new Map(
    tx
      .select({ id: tags.id, name: tags.name })
      .from(tags)
      .where(and(eq(tags.userId, userId), isNull(tags.deletedAt)))
      .all()
      .map((t) => [tagKey(t.name), t.id]),
  )
  const ids: string[] = []
  for (const name of names) {
    const key = tagKey(name)
    let id = byKey.get(key)
    if (!id) {
      id = uuidv7(now)
      tx.insert(tags)
        .values({ id, userId, name, createdAt: now, updatedAt: now, rev: nextRev(tx, userId) })
        .run()
      byKey.set(key, id)
    }
    if (!ids.includes(id)) ids.push(id)
  }
  return ids
}

/**
 * Replaces an entry's tags with `names`. A tag no entry carries any more is deleted, so its
 * spelling doesn't outlive it (typing "travel" later doesn't bring back an old "Travel").
 */
export function writeEntryTags(
  tx: Db,
  userId: string,
  entryId: string,
  names: string[],
  now: number,
) {
  const before = tx
    .select({ tagId: entryTags.tagId })
    .from(entryTags)
    .where(and(eq(entryTags.entryId, entryId), eq(entryTags.userId, userId)))
    .all()
    .map((r) => r.tagId)
  tx.delete(entryTags)
    .where(and(eq(entryTags.entryId, entryId), eq(entryTags.userId, userId)))
    .run()
  const ids = resolveTags(tx, userId, names, now)
  if (ids.length) {
    tx.insert(entryTags)
      .values(ids.map((tagId) => ({ entryId, tagId, userId })))
      .run()
  }
  const dropped = before.filter((id) => !ids.includes(id))
  if (dropped.length) {
    tx.delete(tags)
      .where(
        and(
          eq(tags.userId, userId),
          inArray(tags.id, dropped),
          notExists(
            tx
              .select({ x: sql`1` })
              .from(entryTags)
              .where(eq(entryTags.tagId, tags.id)),
          ),
        ),
      )
      .run()
  }
}

/** The id of the user's live tag with this name (ignoring case), if any. */
export function findTagId(db: Db, userId: string, name: string): string | undefined {
  const key = tagKey(name)
  return db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(and(eq(tags.userId, userId), isNull(tags.deletedAt)))
    .all()
    .find((t) => tagKey(t.name) === key)?.id
}

export class TagNotFoundError extends Error {
  constructor() {
    super('tag not found')
  }
}

/** A rename onto the name of a different tag; the caller can offer a merge instead. */
export class TagExistsError extends Error {
  constructor() {
    super('a tag with that name already exists')
  }
}

/** The user's live entries carrying a tag. */
function taggedEntries(tx: Db, userId: string, tagId: string): string[] {
  return tx
    .select({ id: entries.id })
    .from(entryTags)
    .innerJoin(entries, eq(entries.id, entryTags.entryId))
    .where(
      and(
        eq(entryTags.tagId, tagId),
        eq(entryTags.userId, userId),
        eq(entries.userId, userId),
        isNull(entries.deletedAt),
      ),
    )
    .all()
    .map((e) => e.id)
}

/**
 * Puts every entry carrying `fromId` onto `intoId`, live and trashed alike (a restored entry keeps
 * its tags). Purged entries carry none.
 */
function moveTagRows(tx: Db, userId: string, fromId: string, intoId: string) {
  const carriers = tx
    .select({ entryId: entryTags.entryId })
    .from(entryTags)
    .where(and(eq(entryTags.tagId, fromId), eq(entryTags.userId, userId)))
    .all()
  if (carriers.length)
    tx.insert(entryTags)
      .values(carriers.map(({ entryId }) => ({ entryId, tagId: intoId, userId })))
      .onConflictDoNothing()
      .run()
}

function deleteTag(tx: Db, userId: string, tagId: string) {
  tx.delete(entryTags)
    .where(and(eq(entryTags.tagId, tagId), eq(entryTags.userId, userId)))
    .run()
  tx.delete(tags)
    .where(and(eq(tags.id, tagId), eq(tags.userId, userId)))
    .run()
}

/** Entries whose tags changed: a new rev so devices re-sync them, and a fresh search row. */
function touch(tx: Db, userId: string, entryIds: string[], now: number) {
  for (const id of entryIds) {
    tx.update(entries)
      .set({ updatedAt: now, rev: nextRev(tx, userId) })
      .where(and(eq(entries.id, id), eq(entries.userId, userId)))
      .run()
    indexEntry(tx, id)
  }
}

function touchTagged(tx: Db, userId: string, tagId: string, now: number): number {
  const ids = taggedEntries(tx, userId, tagId)
  touch(tx, userId, ids, now)
  return ids.length
}

export function tagRepo(db: Db, userId: string) {
  return {
    /** The user's tags with their live-entry counts, most used first, then by name. Unused tags are left out. */
    list(): TagCount[] {
      const count = sql<number>`count(*)`
      return db
        .select({ name: tags.name, count: count.as('count') })
        .from(tags)
        .innerJoin(entryTags, eq(entryTags.tagId, tags.id))
        .innerJoin(entries, eq(entries.id, entryTags.entryId))
        .where(
          and(
            eq(tags.userId, userId),
            isNull(tags.deletedAt),
            eq(entries.userId, userId),
            isNull(entries.deletedAt),
          ),
        )
        .groupBy(tags.id)
        .orderBy(sql`count(*) desc`, sql`lower(${tags.name})`)
        .all()
    },

    /**
     * Renames a tag. Entries show tags by name, so each of them changes: their revs bump (devices
     * re-sync them) and their search rows are rewritten. The entry's own dates are left alone.
     */
    rename(name: string, newName: string, now = Date.now()): TagChange {
      return db.transaction((tx) => {
        const id = findTagId(tx, userId, name)
        if (!id) throw new TagNotFoundError()
        const other = findTagId(tx, userId, newName)
        if (other && other !== id) {
          // A tag that only deleted entries still carry isn't in anyone's list, so it can't be a
          // collision the user could see: fold it into this one (entries in the trash keep the
          // tag under its new name) and take its name.
          if (taggedEntries(tx, userId, other).length > 0) throw new TagExistsError()
          moveTagRows(tx, userId, other, id)
          deleteTag(tx, userId, other)
        }
        tx.update(tags)
          .set({ name: newName, updatedAt: now, rev: nextRev(tx, userId) })
          .where(and(eq(tags.id, id), eq(tags.userId, userId)))
          .run()
        return { entries: touchTagged(tx, userId, id, now) }
      })
    },

    /** Moves every entry of `from` onto `into` (keeping `into`'s spelling) and deletes `from`. */
    merge(from: string, into: string, now = Date.now()): TagChange {
      return db.transaction((tx) => {
        const fromId = findTagId(tx, userId, from)
        const intoId = findTagId(tx, userId, into)
        if (!fromId || !intoId) throw new TagNotFoundError()
        if (fromId === intoId) return { entries: 0 }
        const moved = taggedEntries(tx, userId, fromId)
        moveTagRows(tx, userId, fromId, intoId)
        deleteTag(tx, userId, fromId)
        touch(tx, userId, moved, now)
        return { entries: moved.length }
      })
    },

    /** Removes a tag from every entry and deletes it. The entries stay. */
    remove(name: string, now = Date.now()): TagChange {
      return db.transaction((tx) => {
        const id = findTagId(tx, userId, name)
        if (!id) throw new TagNotFoundError()
        const ids = taggedEntries(tx, userId, id)
        deleteTag(tx, userId, id)
        touch(tx, userId, ids, now)
        return { entries: ids.length }
      })
    },
  }
}

export type TagRepo = ReturnType<typeof tagRepo>
