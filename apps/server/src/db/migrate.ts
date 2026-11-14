import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import type { DbHandle } from './index.ts'

export interface MigrateOptions {
  folder: string
  /** Where pre-migrate snapshots go. Omit to skip snapshots (in-memory DBs). */
  backupsDir?: string
  keepSnapshots?: number
  now?: () => number
}

const SNAPSHOT = /^pre-migrate-.*\.db$/

/**
 * Applies pending migrations, forward-only. Drizzle runs all pending ones in a single
 * transaction, so a failure rolls back and throws: the caller must let the process exit rather
 * than start half-migrated. Before applying anything to an already-migrated DB, takes a
 * `VACUUM INTO` snapshot (never a copy of the live file). Returns the pending migration count.
 */
export function runMigrations(
  { sqlite, db }: DbHandle,
  { folder, backupsDir, keepSnapshots = 5, now = Date.now }: MigrateOptions,
): number {
  const hasHistory = !!sqlite
    .prepare("SELECT 1 FROM sqlite_master WHERE name = '__drizzle_migrations'")
    .get()
  const last = hasHistory
    ? (sqlite.prepare('SELECT max(created_at) AS at FROM __drizzle_migrations').get() as {
        at: number | null
      })
    : undefined

  // Same rule drizzle's migrator uses to decide what is pending.
  const pending = readMigrationFiles({ migrationsFolder: folder }).filter(
    (m) => last?.at == null || last.at < m.folderMillis,
  )
  if (pending.length === 0) return 0

  // A DB with no migration history is brand new: nothing to protect.
  if (hasHistory && backupsDir) {
    mkdirSync(backupsDir, { recursive: true })
    const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-')
    const file = join(backupsDir, `pre-migrate-${stamp}.db`)
    sqlite.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`)
    const old = readdirSync(backupsDir)
      .filter((f) => SNAPSHOT.test(f))
      .sort()
    for (const f of old.slice(0, Math.max(0, old.length - keepSnapshots))) {
      rmSync(join(backupsDir, f))
    }
  }

  migrate(db, { migrationsFolder: folder })
  return pending.length
}
