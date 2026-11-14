import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Db } from '../db/index.ts'
import { entries, entryLocations, entryTags, tags } from '../db/schema.ts'
import { splitTitle } from '../entryText.ts'

/** Bump when what gets indexed, or how, changes: the next start rebuilds the index. */
export const INDEX_VERSION = 3

/**
 * (Re)writes one entry's row in the search index from the database: its title, text, place and tags. Call
 * it inside the transaction that changed any of them. A deleted or missing entry just loses its
 * row. `fresh` skips clearing the old row, for a brand-new entry.
 *
 * The row's rowid comes from `entry_fts_key` (one per entry, kept for good), so removing it is a
 * lookup by rowid rather than a scan of the unindexed `entry_id` column.
 *
 * Location and tag edits call this (repo/entries.ts).
 */
export function indexEntry(db: Db, entryId: string, { fresh = false } = {}) {
  if (!fresh) removeFromIndex(db, entryId)
  const e = db
    .select()
    .from(entries)
    .where(and(eq(entries.id, entryId), isNull(entries.deletedAt)))
    .get()
  if (!e) return

  const loc = db.select().from(entryLocations).where(eq(entryLocations.entryId, entryId)).get()
  const place = [loc?.userLabel, loc?.placeName, loc?.locality, loc?.region, loc?.country]
    .filter(Boolean)
    .join(' ')
  const tagNames = db
    .select({ name: tags.name })
    .from(entryTags)
    .innerJoin(tags, eq(tags.id, entryTags.tagId))
    .where(and(eq(entryTags.entryId, entryId), isNull(tags.deletedAt)))
    .all()
    .map((t) => t.name)
    .join(' ')

  const { title, rest } = splitTitle(e.bodyMd)
  db.run(sql`INSERT OR IGNORE INTO entry_fts_key (entry_id) VALUES (${e.id})`)
  db.run(sql`
    INSERT INTO entry_fts (rowid, entry_id, user_id, title, body, place, tags)
    VALUES ((SELECT fts_rowid FROM entry_fts_key WHERE entry_id = ${e.id}),
            ${e.id}, ${e.userId}, ${title}, ${rest}, ${place}, ${tagNames})`)
}

export function removeFromIndex(db: Db, entryId: string) {
  db.run(sql`
    DELETE FROM entry_fts WHERE rowid =
      (SELECT fts_rowid FROM entry_fts_key WHERE entry_id = ${entryId})`)
}

/** A deleted journal takes its entries with it: one statement instead of one per entry. */
export function removeJournalFromIndex(db: Db, userId: string, journalId: string) {
  db.run(sql`
    DELETE FROM entry_fts WHERE rowid IN
      (SELECT k.fts_rowid FROM entry_fts_key k JOIN entry e ON e.id = k.entry_id
       WHERE e.user_id = ${userId} AND e.journal_id = ${journalId})`)
}

/** Rebuilds the whole index from the entries. Returns how many were indexed. */
export function rebuildIndex(db: Db): number {
  return db.transaction((tx) => {
    tx.run(sql`DELETE FROM entry_fts`)
    tx.run(sql`DELETE FROM entry_fts_key`)
    const ids = tx.select({ id: entries.id }).from(entries).where(isNull(entries.deletedAt)).all()
    for (const { id } of ids) indexEntry(tx, id, { fresh: true })
    return ids.length
  })
}

/** At startup, after migrations: rebuilds the index if it was built by older rules (or never). */
export function ensureSearchIndex(db: Db): boolean {
  const row = db.get<{ value: string }>(
    sql`SELECT value FROM search_state WHERE key = 'index_version'`,
  )
  if (row && Number(row.value) === INDEX_VERSION) return false
  rebuildIndex(db)
  db.run(sql`
    INSERT INTO search_state (key, value) VALUES ('index_version', ${String(INDEX_VERSION)})
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
  return true
}
