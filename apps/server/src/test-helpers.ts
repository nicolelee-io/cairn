import { resolve } from 'node:path'
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { UserRole } from '@cairn/shared'
import { openDb } from './db/index.ts'
import { entries } from './db/schema.ts'
import { runMigrations } from './db/migrate.ts'
import { createUser } from './repo/users.ts'
import { hashPassword } from './auth/password.ts'

export const MIGRATIONS = resolve(import.meta.dirname, '../drizzle')

export function memoryDb() {
  const handle = openDb(':memory:')
  runMigrations(handle, { folder: MIGRATIONS })
  return handle
}

export async function addUser(
  db: ReturnType<typeof memoryDb>['db'],
  username: string,
  password = 'pw',
  role: UserRole = 'user',
) {
  return createUser(db, {
    username,
    passwordHash: await hashPassword(password),
    displayName: username,
    timezone: 'America/Denver',
    role,
  })
}

/** A user's live entry rows, newest first (raw rows, for tests that check what was written). */
export function listEntries(
  db: ReturnType<typeof memoryDb>['db'],
  userId: string,
  { journalId, limit = 50 }: { journalId?: string; limit?: number } = {},
) {
  return db
    .select()
    .from(entries)
    .where(
      and(
        eq(entries.userId, userId),
        isNull(entries.deletedAt),
        journalId ? eq(entries.journalId, journalId) : undefined,
      ),
    )
    .orderBy(desc(entries.createdAt))
    .limit(limit)
    .all()
}
