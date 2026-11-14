import { and, asc, count, eq, isNull, max } from 'drizzle-orm'
import { uuidv7 } from '@cairn/shared'
import type { Db } from '../db/index.ts'
import { entries, journals, users } from '../db/schema.ts'
import { removeJournalFromIndex } from '../search/index.ts'
import { replayOrFree } from './clientId.ts'
import { JournalArchivedError, JournalNotFoundError } from './entries.ts'
import { nextRev } from './rev.ts'

export interface JournalInput {
  id?: string
  name: string
  color?: string | null
  icon?: string | null
  description?: string | null
}

/** Every query here is filtered by `userId` and excludes tombstones. */
export function journalRepo(db: Db, userId: string) {
  const mine = (id: string) =>
    and(eq(journals.id, id), eq(journals.userId, userId), isNull(journals.deletedAt))

  return {
    list({ includeArchived = false } = {}) {
      return db
        .select()
        .from(journals)
        .where(
          and(
            eq(journals.userId, userId),
            isNull(journals.deletedAt),
            includeArchived ? undefined : isNull(journals.archivedAt),
          ),
        )
        .orderBy(asc(journals.sortOrder), asc(journals.createdAt))
        .all()
    },

    /** Live entries per journal id (journals with none are absent). */
    entryCounts(): Map<string, number> {
      const rows = db
        .select({ journalId: entries.journalId, n: count() })
        .from(entries)
        .where(and(eq(entries.userId, userId), isNull(entries.deletedAt)))
        .groupBy(entries.journalId)
        .all()
      return new Map(rows.map((r) => [r.journalId, r.n]))
    },

    /**
     * The journal the New entry button targets: the chosen one while it is still live and not
     * archived, otherwise the first active journal, otherwise null (nothing to write into yet).
     */
    defaultId(): string | null {
      const chosen = db
        .select({ id: users.defaultJournalId })
        .from(users)
        .where(eq(users.id, userId))
        .get()?.id
      const active = db
        .select({ id: journals.id })
        .from(journals)
        .where(
          and(eq(journals.userId, userId), isNull(journals.deletedAt), isNull(journals.archivedAt)),
        )
        .orderBy(asc(journals.sortOrder), asc(journals.createdAt))
        .all()
        .map((j) => j.id)
      return chosen && active.includes(chosen) ? chosen : (active[0] ?? null)
    },

    /** Pass null to go back to "first active journal". */
    setDefault(id: string | null) {
      db.transaction((tx) => {
        if (id !== null) {
          const j = tx
            .select({ archivedAt: journals.archivedAt })
            .from(journals)
            .where(
              and(eq(journals.id, id), eq(journals.userId, userId), isNull(journals.deletedAt)),
            )
            .get()
          if (!j) throw new JournalNotFoundError()
          if (j.archivedAt !== null) throw new JournalArchivedError()
        }
        tx.update(users).set({ defaultJournalId: id }).where(eq(users.id, userId)).run()
      })
    },

    get(id: string) {
      return db.select().from(journals).where(mine(id)).get()
    },

    findByName(name: string) {
      return db
        .select()
        .from(journals)
        .where(
          and(eq(journals.userId, userId), eq(journals.name, name), isNull(journals.deletedAt)),
        )
        .get()
    },

    /**
     * Idempotent on a client-supplied id: a replay returns the existing journal. An id that is
     * someone else's, or tombstoned, is never reused (`IdTakenError`).
     */
    create(input: JournalInput, now = Date.now()) {
      return db.transaction((tx) => {
        if (input.id) {
          const replay = replayOrFree(
            tx.select().from(journals).where(eq(journals.id, input.id)).get(),
            userId,
          )
          if (replay) return replay
        }
        // Last in the user's order, so a new journal doesn't tie with the first one after a reorder.
        const top = tx
          .select({ n: max(journals.sortOrder) })
          .from(journals)
          .where(and(eq(journals.userId, userId), isNull(journals.deletedAt)))
          .get()?.n
        const row = {
          id: input.id ?? uuidv7(now),
          sortOrder: top === null || top === undefined ? 0 : top + 1,
          userId,
          name: input.name,
          color: input.color ?? null,
          icon: input.icon ?? null,
          description: input.description ?? null,
          createdAt: now,
          updatedAt: now,
          rev: nextRev(tx, userId),
        }
        tx.insert(journals).values(row).run()
        return tx.select().from(journals).where(eq(journals.id, row.id)).get()!
      })
    },

    update(
      id: string,
      patch: {
        name?: string
        color?: string | null
        icon?: string | null
        description?: string | null
        archived?: boolean
        sortOrder?: number
      },
      now = Date.now(),
    ) {
      return db.transaction((tx) => {
        const set: Partial<typeof journals.$inferInsert> = { updatedAt: now }
        if (patch.name !== undefined) set.name = patch.name
        if (patch.color !== undefined) set.color = patch.color
        if (patch.icon !== undefined) set.icon = patch.icon
        if (patch.description !== undefined) set.description = patch.description
        if (patch.sortOrder !== undefined) set.sortOrder = patch.sortOrder
        if (patch.archived !== undefined) set.archivedAt = patch.archived ? now : null
        const existing = tx.select({ id: journals.id }).from(journals).where(mine(id)).get()
        if (!existing) return undefined
        set.rev = nextRev(tx, userId)
        return tx.update(journals).set(set).where(mine(id)).returning().get()
      })
    },

    /**
     * Put the given journals in this order (sort order = position); the rest keep their relative
     * order after them. Ids that aren't one of this user's live journals are skipped (a client's
     * list can be stale, e.g. a journal deleted on another device). Only journals whose position
     * changed get a new rev, so the sync feed stays small.
     */
    reorder(ids: string[], now = Date.now()) {
      db.transaction((tx) => {
        const all = tx
          .select()
          .from(journals)
          .where(and(eq(journals.userId, userId), isNull(journals.deletedAt)))
          .orderBy(asc(journals.sortOrder), asc(journals.createdAt))
          .all()
        const known = new Set(all.map((j) => j.id))
        const chosen = [...new Set(ids)].filter((id) => known.has(id))
        const picked = new Set(chosen)
        const order = [...chosen, ...all.filter((j) => !picked.has(j.id)).map((j) => j.id)]
        const current = new Map(all.map((j) => [j.id, j.sortOrder]))
        order.forEach((id, i) => {
          if (current.get(id) === i) return
          tx.update(journals)
            .set({ sortOrder: i, updatedAt: now, rev: nextRev(tx, userId) })
            .where(mine(id))
            .run()
        })
      })
    },

    /**
     * Deleting a journal tombstones its entries too, so none are left orphaned and invisible. It
     * all goes to the trash, and the journal and its entries share one `deletedAt` on purpose:
     * restoring the journal (repo/trash.ts) brings back only the entries stamped with it.
     */
    softDelete(id: string, now = Date.now()) {
      return db.transaction((tx) => {
        const existing = tx.select({ id: journals.id }).from(journals).where(mine(id)).get()
        if (!existing) return false
        const live = tx
          .select({ id: entries.id })
          .from(entries)
          .where(
            and(eq(entries.journalId, id), eq(entries.userId, userId), isNull(entries.deletedAt)),
          )
          .all()
        for (const e of live) {
          tx.update(entries)
            .set({ deletedAt: now, updatedAt: now, rev: nextRev(tx, userId) })
            .where(and(eq(entries.id, e.id), eq(entries.userId, userId)))
            .run()
        }
        removeJournalFromIndex(tx, userId, id)
        tx.update(journals)
          .set({ deletedAt: now, updatedAt: now, rev: nextRev(tx, userId) })
          .where(mine(id))
          .run()
        return true
      })
    },
  }
}
