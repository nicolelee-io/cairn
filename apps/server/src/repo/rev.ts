import { eq, sql } from 'drizzle-orm'
import type { Db } from '../db/index.ts'
import { users } from '../db/schema.ts'

/**
 * Next per-user revision. Call inside the same transaction as the write it stamps, so a failed
 * write doesn't burn a rev and two writes never share one.
 */
export function nextRev(db: Db, userId: string): number {
  const row = db
    .update(users)
    .set({ lastRev: sql`${users.lastRev} + 1` })
    .where(eq(users.id, userId))
    .returning({ rev: users.lastRev })
    .get()
  if (!row) throw new Error(`unknown user ${userId}`)
  return row.rev
}
