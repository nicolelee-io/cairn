import { and, desc, eq, inArray, isNotNull, isNull, lt, notExists, or, sql } from 'drizzle-orm'
import {
  DEFAULT_TRASH_RETENTION_DAYS,
  TrashRetentionDaysSchema,
  decodeCursor,
  encodeCursor,
  trashPurgeAt,
  type TrashCount,
  type TrashEntriesPage,
  type TrashJournal,
  type TrashPurged,
} from '@cairn/shared'
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
import { indexEntry } from '../search/index.ts'
import { appSettingsRepo } from './appSettings.ts'
import { JournalArchivedError, entryCards, entryRepo } from './entries.ts'
import { nextRev } from './rev.ts'

// The trash is the rows with `deleted_at` set and `purged_at` null. Deleting is unchanged (every
// other query already leaves deleted rows out); this file restores and purges them. A journal's
// entries were deleted with it when their `deleted_at` equals the journal's (journalRepo.softDelete
// stamps them all with one `now`), and only those come back with it.
//
// Purging scrubs the content and keeps the row: a device offline for longer than the retention
// still needs the tombstone in the sync feed. It bumps no rev (devices already dropped the row).

const DAY_MS = 24 * 60 * 60 * 1000
export const TRASH_RETENTION_KEY = 'trash_retention_days'

/** The server's trash retention in days (an admin setting), or the default. */
export function trashRetentionDays(db: Db): number {
  const parsed = TrashRetentionDaysSchema.safeParse(
    Number(appSettingsRepo(db).get(TRASH_RETENTION_KEY)),
  )
  return parsed.success ? parsed.data : DEFAULT_TRASH_RETENTION_DAYS
}

/** Restoring an entry whose journal is in the trash: restore the journal instead. */
export class JournalDeletedError extends Error {
  constructor() {
    super('journal is deleted')
  }
}

const trashed = (t: typeof entries | typeof journals) =>
  and(isNotNull(t.deletedAt), isNull(t.purgedAt))

/** SQLite caps bound parameters; big journals go in slices. */
function inSlices<T>(ids: T[], fn: (slice: T[]) => void, size = 500) {
  for (let i = 0; i < ids.length; i += size) fn(ids.slice(i, i + size))
}

/** Brings deleted entries back: new revs for them and their live media, and fresh search rows. */
function restoreEntryRows(tx: Db, userId: string, ids: string[], now: number) {
  for (const id of ids) {
    tx.update(entries)
      .set({ deletedAt: null, updatedAt: now, rev: nextRev(tx, userId) })
      .where(and(eq(entries.id, id), eq(entries.userId, userId)))
      .run()
    // Devices drop an entry's media when it is deleted, so the feed has to send them again.
    for (const t of [photos, attachments] as const) {
      const live = tx
        .select({ id: t.id })
        .from(t)
        .where(and(eq(t.entryId, id), eq(t.userId, userId), isNull(t.deletedAt)))
        .all()
      for (const m of live)
        tx.update(t)
          .set({ updatedAt: now, rev: nextRev(tx, userId) })
          .where(eq(t.id, m.id))
          .run()
    }
    indexEntry(tx, id)
  }
}

/**
 * Deletes for good: the text, mood, place, weather and tags go; the row stays as a tombstone.
 * Their photos and attachments are tombstoned by the next media cleanup (photos/gc.ts), which
 * then frees the files. Only rows already deleted are touched. Returns how many were purged.
 */
export function purgeEntries(tx: Db, userId: string, ids: string[], now: number): number {
  let n = 0
  inSlices(ids, (slice) => {
    const rows = tx
      .update(entries)
      .set({
        purgedAt: now,
        bodyMd: '',
        sourceRaw: null,
        moodKey: null,
        moodSuggested: null,
        moodSuggestedBy: null,
      })
      .where(and(inArray(entries.id, slice), eq(entries.userId, userId), trashed(entries)))
      .returning({ id: entries.id })
      .all()
    const done = rows.map((r) => r.id)
    n += done.length
    if (!done.length) return
    tx.delete(entryLocations).where(inArray(entryLocations.entryId, done)).run()
    tx.delete(entryWeather).where(inArray(entryWeather.entryId, done)).run()
    const tagIds = [
      ...new Set(
        tx
          .select({ tagId: entryTags.tagId })
          .from(entryTags)
          .where(inArray(entryTags.entryId, done))
          .all()
          .map((r) => r.tagId),
      ),
    ]
    tx.delete(entryTags).where(inArray(entryTags.entryId, done)).run()
    // As writeEntryTags does: a tag nothing carries any more goes too.
    if (tagIds.length)
      tx.delete(tags)
        .where(
          and(
            eq(tags.userId, userId),
            inArray(tags.id, tagIds),
            notExists(
              tx
                .select({ x: sql`1` })
                .from(entryTags)
                .where(eq(entryTags.tagId, tags.id)),
            ),
          ),
        )
        .run()
  })
  return n
}

/** Purges deleted journals and every deleted entry still in them. */
function purgeJournals(tx: Db, userId: string, ids: string[], now: number): TrashPurged {
  let purged: TrashPurged = { entries: 0, journals: 0 }
  inSlices(ids, (slice) => {
    const inside = tx
      .select({ id: entries.id })
      .from(entries)
      .where(and(inArray(entries.journalId, slice), eq(entries.userId, userId), trashed(entries)))
      .all()
      .map((e) => e.id)
    const n = tx
      .update(journals)
      .set({ purgedAt: now, name: '', description: null, color: null, icon: null })
      .where(and(inArray(journals.id, slice), eq(journals.userId, userId), trashed(journals)))
      .returning({ id: journals.id })
      .all().length
    purged = {
      entries: purged.entries + purgeEntries(tx, userId, inside, now),
      journals: purged.journals + n,
    }
  })
  return purged
}

/** Every query here is filtered by `userId`. */
export function trashRepo(db: Db, userId: string) {
  /** Trashed entries a user can see on their own: their journal is live. */
  const listable = and(
    eq(entries.userId, userId),
    trashed(entries),
    isNull(journals.deletedAt),
    eq(journals.userId, userId),
  )

  return {
    /** Entries in the trash whose journal is live, most recently deleted first. */
    entries({ cursor, limit = 50 }: { cursor?: string; limit?: number } = {}): TrashEntriesPage {
      const days = trashRetentionDays(db)
      const c = cursor ? decodeCursor(cursor) : null
      const rows = db
        .select({ e: entries })
        .from(entries)
        .innerJoin(journals, eq(journals.id, entries.journalId))
        .where(
          and(
            listable,
            c
              ? or(
                  lt(entries.deletedAt, c.createdAt),
                  and(eq(entries.deletedAt, c.createdAt), lt(entries.id, c.id)),
                )
              : undefined,
          ),
        )
        .orderBy(desc(entries.deletedAt), desc(entries.id))
        .limit(limit + 1)
        .all()
        .map((r) => r.e)
      const page = rows.slice(0, limit)
      const cards = entryCards(db, userId, page)
      const last = page.at(-1)
      return {
        items: cards.map((card, i) => {
          const deletedAt = page[i]!.deletedAt!
          return { ...card, deletedAt, purgeAt: trashPurgeAt(deletedAt, days) }
        }),
        nextCursor: rows.length > limit && last ? encodeCursor(last.deletedAt!, last.id) : null,
      }
    },

    /** One trashed entry to read before restoring it (its journal must be live, as in the list). */
    entryDetail(id: string) {
      const row = db
        .select({ e: entries })
        .from(entries)
        .innerJoin(journals, eq(journals.id, entries.journalId))
        .where(and(listable, eq(entries.id, id)))
        .get()?.e
      if (!row) return undefined
      return {
        ...entryRepo(db, userId).detailOf(row),
        deletedAt: row.deletedAt!,
        purgeAt: trashPurgeAt(row.deletedAt!, trashRetentionDays(db)),
      }
    },

    /** Journals in the trash, with the entries that went with them. */
    journals(): TrashJournal[] {
      const days = trashRetentionDays(db)
      const js = db
        .select()
        .from(journals)
        .where(and(eq(journals.userId, userId), trashed(journals)))
        .orderBy(desc(journals.deletedAt))
        .all()
      const counts = new Map(
        js.length
          ? db
              .select({ journalId: entries.journalId, n: sql<number>`count(*)` })
              .from(entries)
              .innerJoin(journals, eq(journals.id, entries.journalId))
              .where(
                and(
                  eq(entries.userId, userId),
                  inArray(
                    entries.journalId,
                    js.map((j) => j.id),
                  ),
                  trashed(entries),
                  eq(entries.deletedAt, journals.deletedAt),
                ),
              )
              .groupBy(entries.journalId)
              .all()
              .map((r) => [r.journalId, r.n])
          : [],
      )
      return js.map((j) => ({
        id: j.id,
        name: j.name,
        color: j.color,
        icon: j.icon,
        deletedAt: j.deletedAt!,
        purgeAt: trashPurgeAt(j.deletedAt!, days),
        entryCount: counts.get(j.id) ?? 0,
      }))
    },

    count(): TrashCount {
      const e = db
        .select({ n: sql<number>`count(*)` })
        .from(entries)
        .innerJoin(journals, eq(journals.id, entries.journalId))
        .where(listable)
        .get()
      const j = db
        .select({ n: sql<number>`count(*)` })
        .from(journals)
        .where(and(eq(journals.userId, userId), trashed(journals)))
        .get()
      return { entries: e?.n ?? 0, journals: j?.n ?? 0 }
    },

    /**
     * Undeletes one entry. Undefined when it isn't in this user's trash. Its journal has to be
     * live (`JournalDeletedError`) and writable (`JournalArchivedError`), like any edit.
     */
    restoreEntry(id: string, now = Date.now()) {
      return db.transaction((tx) => {
        const e = tx
          .select()
          .from(entries)
          .where(and(eq(entries.id, id), eq(entries.userId, userId), trashed(entries)))
          .get()
        if (!e) return undefined
        const j = tx
          .select()
          .from(journals)
          .where(and(eq(journals.id, e.journalId), eq(journals.userId, userId)))
          .get()
        if (!j || j.deletedAt !== null) throw new JournalDeletedError()
        if (j.archivedAt !== null) throw new JournalArchivedError()
        restoreEntryRows(tx, userId, [id], now)
        return tx.select().from(entries).where(eq(entries.id, id)).get()!
      })
    },

    /** Undeletes a journal and the entries deleted with it. Undefined when it isn't in the trash. */
    restoreJournal(id: string, now = Date.now()) {
      return db.transaction((tx) => {
        const j = tx
          .select()
          .from(journals)
          .where(and(eq(journals.id, id), eq(journals.userId, userId), trashed(journals)))
          .get()
        if (!j) return undefined
        const withIt = tx
          .select({ id: entries.id })
          .from(entries)
          .where(
            and(
              eq(entries.journalId, id),
              eq(entries.userId, userId),
              trashed(entries),
              eq(entries.deletedAt, j.deletedAt!),
            ),
          )
          .all()
          .map((e) => e.id)
        tx.update(journals)
          .set({ deletedAt: null, updatedAt: now, rev: nextRev(tx, userId) })
          .where(eq(journals.id, id))
          .run()
        restoreEntryRows(tx, userId, withIt, now)
        return tx.select().from(journals).where(eq(journals.id, id)).get()!
      })
    },

    /** Deletes one entry for good. False when it isn't in this user's trash. */
    purgeEntry(id: string, now = Date.now()): boolean {
      return db.transaction((tx) => purgeEntries(tx, userId, [id], now) > 0)
    },

    /** Deletes a journal and its deleted entries for good. Null when it isn't in the trash. */
    purgeJournal(id: string, now = Date.now()): TrashPurged | null {
      return db.transaction((tx) => {
        const p = purgeJournals(tx, userId, [id], now)
        return p.journals ? p : null
      })
    },

    /** Empties the user's trash. */
    empty(now = Date.now()): TrashPurged {
      return db.transaction((tx) => {
        const js = tx
          .select({ id: journals.id })
          .from(journals)
          .where(and(eq(journals.userId, userId), trashed(journals)))
          .all()
          .map((j) => j.id)
        const fromJournals = purgeJournals(tx, userId, js, now)
        const rest = tx
          .select({ id: entries.id })
          .from(entries)
          .where(and(eq(entries.userId, userId), trashed(entries)))
          .all()
          .map((e) => e.id)
        return {
          entries: fromJournals.entries + purgeEntries(tx, userId, rest, now),
          journals: fromJournals.journals,
        }
      })
    },
  }
}

export type TrashRepo = ReturnType<typeof trashRepo>

/**
 * Maintenance, so not scoped to one user (like `purgeExpiredSessions`): purges what has been in
 * the trash longer than the retention. A journal takes its deleted entries with it, whenever they
 * were deleted. `dryRun` counts and changes nothing.
 */
export function purgeExpiredTrash(
  db: Db,
  retentionDays: number,
  now = Date.now(),
  { dryRun = false } = {},
): TrashPurged {
  const cutoff = now - retentionDays * DAY_MS
  const expiredJournals = db
    .select({ id: journals.id, userId: journals.userId })
    .from(journals)
    .where(and(trashed(journals), lt(journals.deletedAt, cutoff)))
    .all()
  const expiredJournalIds = new Set(expiredJournals.map((j) => j.id))
  const expiredEntries = db
    .select({ id: entries.id, userId: entries.userId, journalId: entries.journalId })
    .from(entries)
    .where(and(trashed(entries), lt(entries.deletedAt, cutoff)))
    .all()
  if (dryRun) {
    const inJournals = db
      .select({ id: entries.id })
      .from(entries)
      .innerJoin(journals, eq(journals.id, entries.journalId))
      .where(and(trashed(entries), trashed(journals), lt(journals.deletedAt, cutoff)))
      .all()
    const ids = new Set([...expiredEntries.map((e) => e.id), ...inJournals.map((e) => e.id)])
    return { entries: ids.size, journals: expiredJournals.length }
  }
  const byUser = new Map<string, { journals: string[]; entries: string[] }>()
  const of = (u: string) => {
    let x = byUser.get(u)
    if (!x) byUser.set(u, (x = { journals: [], entries: [] }))
    return x
  }
  for (const j of expiredJournals) of(j.userId).journals.push(j.id)
  for (const e of expiredEntries)
    if (!expiredJournalIds.has(e.journalId)) of(e.userId).entries.push(e.id)
  let total: TrashPurged = { entries: 0, journals: 0 }
  for (const [userId, x] of byUser) {
    const p = db.transaction((tx) => {
      const fromJournals = purgeJournals(tx, userId, x.journals, now)
      return {
        entries: fromJournals.entries + purgeEntries(tx, userId, x.entries, now),
        journals: fromJournals.journals,
      }
    })
    total = { entries: total.entries + p.entries, journals: total.journals + p.journals }
  }
  return total
}
