import type { ServerHealth } from '@cairn/shared'
import { readBackupStatus } from '../backup/status.ts'
import type { Db } from '../db/index.ts'
import { appSettingsRepo } from '../repo/appSettings.ts'

/** A real write, so a read-only file, a full disk or a lock that never clears shows up. */
export function probeDatabase(db: Db, now: number): boolean {
  try {
    appSettingsRepo(db).set('health_probe', String(now), now)
    return true
  } catch {
    return false
  }
}

/** Everything the alerts watch, measured now. Pure over its inputs apart from the probe write. */
export function checkHealth(db: Db, dataDir: string, now = Date.now()): ServerHealth {
  const problems: ServerHealth['problems'] = []

  // `none` means no backup was ever set up: nothing to be wrong about.
  const backup = readBackupStatus(dataDir, now)
  if (backup.state === 'failing') {
    problems.push({
      id: 'backup',
      message: `The last backup failed${backup.lastRunError ? `: ${backup.lastRunError.replace(/[.\s]*$/, '')}` : ''}.`,
    })
  } else if (backup.state === 'stale') {
    problems.push({ id: 'backup', message: 'No backup has succeeded in over 36 hours.' })
  }

  const databaseWritable = probeDatabase(db, now)
  if (!databaseWritable) {
    problems.push({ id: 'database', message: 'Cairn couldn’t save to its database.' })
  }

  return { problems, databaseWritable, checkedAt: now }
}
