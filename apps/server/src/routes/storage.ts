import { Hono } from 'hono'
import type { StorageUsage } from '@cairn/shared'
import type { AuthEnv } from '../auth/middleware.ts'
import type { Db } from '../db/index.ts'
import { userUsage } from '../storage/usage.ts'

/** GET /api/storage: the caller's own usage, per journal. */
export function storageRoutes(db: Db, dataDir: string) {
  const r = new Hono<AuthEnv>()
  r.get('/', async (c) => c.json<StorageUsage>(await userUsage(db, dataDir, c.get('userId'))))
  return r
}
