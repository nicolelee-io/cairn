import { eq } from 'drizzle-orm'
import type { Db } from '../db/index.ts'
import { appSettings } from '../db/schema.ts'

/** Instance-wide settings (not per user). Callers are routes behind a session. */
export const appSettingsRepo = (db: Db) => ({
  get: (key: string) => db.select().from(appSettings).where(eq(appSettings.key, key)).get()?.value,
  set(key: string, value: string, now = Date.now()) {
    db.insert(appSettings)
      .values({ key, value, updatedAt: now })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: now } })
      .run()
  },
  delete: (key: string) => void db.delete(appSettings).where(eq(appSettings.key, key)).run(),
})
