import type { Db } from './db/index.ts'
import { collectMediaGarbage, describeCleanup, type CleanupResult } from './photos/gc.ts'
import { purgeExpiredTrash, trashRetentionDays } from './repo/trash.ts'

export type MaintenanceResult = CleanupResult & { expiredEntries: number; expiredJournals: number }

/**
 * The daily housekeeping, also behind the admin's Clean up now: what has been in the trash past
 * the retention is purged, then the media cleanup frees what that (and anything else) left
 * behind. A dry run changes nothing, so its media numbers don't include what the expiry would
 * free; the next real run does.
 */
export function runMaintenance(
  db: Db,
  dataDir: string,
  now = Date.now(),
  { dryRun = false } = {},
): MaintenanceResult {
  const expired = purgeExpiredTrash(db, trashRetentionDays(db), now, { dryRun })
  const media = collectMediaGarbage(db, dataDir, now, { dryRun })
  return { ...media, expiredEntries: expired.entries, expiredJournals: expired.journals }
}

/** One line for the server log, or null when there was nothing to do or report. */
export function describeMaintenance(r: MaintenanceResult): string | null {
  const trash =
    r.expiredEntries || r.expiredJournals
      ? `trash${r.dryRun ? ' (dry run)' : ''}: ${r.expiredEntries} entry(ies) and ${r.expiredJournals} journal(s) past the retention purged`
      : null
  return [trash, describeCleanup(r)].filter(Boolean).join('\n') || null
}
