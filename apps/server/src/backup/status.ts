import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { BackupStatus } from '@cairn/shared'

/** Where the backup sidecar reports to, inside the data volume both containers mount. */
export const statusFile = (dataDir: string) => join(dataDir, 'backups', 'backup-status.json')

/** A nightly backup that hasn't succeeded for this long has been missed, whatever else is said. */
export const STALE_AFTER_MS = 36 * 60 * 60 * 1000

// What backup/backup.sh and verify.sh write. The sidecar is a separate image that can be older or
// newer than this server, so anything missing or malformed is treated as absent, never an error.
const when = z.number().catch(0)
const Run = z.object({ at: when, ok: z.boolean(), error: z.string().nullable().catch(null) })
const FileSchema = z.object({
  lastRun: Run.nullable().catch(null),
  lastSuccess: z
    .object({ at: when, snapshotId: z.string().nullable().catch(null) })
    .nullable()
    .catch(null),
  lastVerify: Run.nullable().catch(null),
})

const NONE: BackupStatus = {
  state: 'none',
  lastRunAt: null,
  lastRunError: null,
  lastSuccessAt: null,
  snapshotId: null,
  lastVerifyAt: null,
  lastVerifyOk: null,
  lastVerifyError: null,
}

/** The sidecar's last report, boiled down to one state for Settings. */
export function readBackupStatus(dataDir: string, now = Date.now()): BackupStatus {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(statusFile(dataDir), 'utf8'))
  } catch {
    return NONE
  }
  const parsed = FileSchema.safeParse(raw)
  if (!parsed.success || (!parsed.data.lastRun && !parsed.data.lastSuccess)) return NONE
  const { lastRun, lastSuccess, lastVerify } = parsed.data
  const state: BackupStatus['state'] =
    lastRun && !lastRun.ok
      ? 'failing'
      : !lastSuccess || now - lastSuccess.at > STALE_AFTER_MS
        ? 'stale'
        : 'ok'
  return {
    state,
    lastRunAt: lastRun?.at ?? null,
    lastRunError: lastRun && !lastRun.ok ? lastRun.error : null,
    lastSuccessAt: lastSuccess?.at ?? null,
    snapshotId: lastSuccess?.snapshotId ?? null,
    lastVerifyAt: lastVerify?.at ?? null,
    lastVerifyOk: lastVerify?.ok ?? null,
    lastVerifyError: lastVerify && !lastVerify.ok ? lastVerify.error : null,
  }
}
