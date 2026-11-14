import { Hono } from 'hono'
import type { AuthEnv } from '../auth/middleware.ts'
import { readBackupStatus } from '../backup/status.ts'

/**
 * What the backup sidecar last reported, read from a file in the data volume. Instance-wide like
 * the Google key, so it needs a session but isn't scoped to a user; it never exposes the repository
 * address or any credential (the sidecar doesn't write them there).
 */
export function backupRoutes(dataDir: string) {
  const r = new Hono<AuthEnv>()
  r.get('/status', (c) => c.json(readBackupStatus(dataDir)))
  return r
}
