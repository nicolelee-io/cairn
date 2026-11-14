import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { createApp } from './app.ts'
import { loadConfig } from './config.ts'
import { openDb } from './db/index.ts'
import { runMigrations } from './db/migrate.ts'
import { checkHealth } from './health/check.ts'
import { healthMonitor } from './health/monitor.ts'
import { notifySettings, sendAlert } from './health/notify.ts'
import { googleKeys } from './places/index.ts'
import { describeMaintenance, runMaintenance } from './maintenance.ts'
import { photoQuality } from './photos/quality.ts'
import { clearImportUploads } from './import/jobs.ts'
import { ensureSearchIndex } from './search/index.ts'
import { purgeExpiredSessions } from './repo/sessions.ts'
import { seedInitialUser } from './seed.ts'
import { shutdownHandler } from './shutdown.ts'

const config = loadConfig()
mkdirSync(config.dataDir, { recursive: true })

const handle = openDb(join(config.dataDir, 'cairn.db'))
// A failing migration throws here and takes the process down: never serve a half-migrated DB.
const applied = runMigrations(handle, {
  folder: config.migrationsDir,
  backupsDir: join(config.dataDir, 'backups'),
})
if (applied) console.log(`applied ${applied} migration(s)`)
if (ensureSearchIndex(handle.db)) console.log('rebuilt the search index')
await seedInitialUser(handle.db, config.initialUser)
purgeExpiredSessions(handle.db)
// Imports from Settings live in memory, so an upload left by the last process is of no use.
clearImportUploads(config.dataDir)
// Decided once: a server that already has photos keeps originals until an admin says otherwise.
console.log(`photo quality: ${photoQuality(handle.db).get()}`)

const sweep = () => {
  try {
    const line = describeMaintenance(runMaintenance(handle.db, config.dataDir))
    if (line) console.log(line)
  } catch (e) {
    console.error('cleanup failed', e) // housekeeping must never stop the server
  }
}
sweep()
setInterval(sweep, 24 * 60 * 60 * 1000).unref()

// Server alerts (Settings > Server): checked every 15 minutes while on, and a minute after start.
const settings = notifySettings(handle.db)
const monitor = healthMonitor({
  enabled: () => settings.read().enabled,
  check: (now) => checkHealth(handle.db, config.dataDir, now),
  send: (alert) => sendAlert(settings.read(), alert),
})
const watch = () => monitor.tick().catch((e) => console.error('health check failed', e))
setTimeout(watch, 60_000).unref()
setInterval(watch, 15 * 60_000).unref()

const server = serve(
  {
    fetch: createApp({
      sha: config.sha,
      builtAt: config.builtAt,
      db: handle.db,
      dataDir: config.dataDir,
      googleKeys: googleKeys(handle.db, config.googleApiKey),
      webDist: config.webDist,
      trustProxy: config.trustProxy,
    }).fetch,
    port: config.port,
  },
  (info) => console.log(`cairn ${config.sha} listening on :${info.port}`),
)

// `docker stop` sends SIGTERM: finish in-flight requests, then close SQLite so the WAL is flushed.
const shutdown = shutdownHandler(server, () => handle.sqlite.close())
for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, shutdown)
