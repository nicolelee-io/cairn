import { and, asc, count, eq, sql } from 'drizzle-orm'
import { MAX_USER_TEMPLATES, uuidv7, type CreateTemplate, type UpdateTemplate } from '@cairn/shared'
import type { Db } from '../db/index.ts'
import { templates } from '../db/schema.ts'

/** The caller already has `MAX_USER_TEMPLATES` templates. */
export class TemplateLimitError extends Error {
  constructor() {
    super('template limit reached')
  }
}

/**
 * The caller's entry templates. Every query filters by `user_id`, so another user's id is simply
 * not found. Settings-like: no rev, tombstones or sync feed, and rows are deleted outright.
 */
export function templateRepo(db: Db, userId: string) {
  const mine = eq(templates.userId, userId)
  const one = (id: string) => and(eq(templates.id, id), mine)

  return {
    /** By name (case ignored), then oldest first; `rowid` orders rows written in one millisecond. */
    list: () =>
      db
        .select()
        .from(templates)
        .where(mine)
        .orderBy(asc(sql`lower(${templates.name})`), asc(templates.createdAt), asc(sql`rowid`))
        .all(),

    create(input: CreateTemplate, now = Date.now()) {
      return db.transaction((tx) => {
        const n = tx.select({ n: count() }).from(templates).where(mine).get()?.n ?? 0
        if (n >= MAX_USER_TEMPLATES) throw new TemplateLimitError()
        const row = {
          id: uuidv7(now),
          userId,
          name: input.name,
          bodyMd: input.bodyMd,
          createdAt: now,
          updatedAt: now,
        }
        tx.insert(templates).values(row).run()
        return row
      })
    },

    update: (id: string, patch: UpdateTemplate, now = Date.now()) =>
      db
        .update(templates)
        .set({ ...patch, updatedAt: now })
        .where(one(id))
        .returning()
        .get(),

    remove: (id: string) => db.delete(templates).where(one(id)).run().changes > 0,
  }
}
