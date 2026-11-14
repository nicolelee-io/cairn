import { ATTACHMENT_MAX_MB } from '@cairn/shared'
import type { Db } from '../db/index.ts'
import { appSettingsRepo } from '../repo/appSettings.ts'

const KEY = 'attachment_max_mb'

/**
 * The largest attachment upload, set in Settings (instance-wide). Never above ATTACHMENT_MAX_MB:
 * Cloudflare refuses requests over 100 MB, so a bigger setting would only fail later and worse.
 */
export function attachmentLimit(db: Db) {
  const store = appSettingsRepo(db)
  return {
    mb() {
      const saved = Number(store.get(KEY))
      return saved > 0 ? Math.min(saved, ATTACHMENT_MAX_MB) : ATTACHMENT_MAX_MB
    },
    set: (mb: number) => store.set(KEY, String(mb)),
  }
}
