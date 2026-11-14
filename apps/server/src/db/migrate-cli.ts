import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { loadConfig } from '../config.ts'
import { openDb } from './index.ts'
import { runMigrations } from './migrate.ts'

const config = loadConfig()
mkdirSync(config.dataDir, { recursive: true })
const handle = openDb(join(config.dataDir, 'cairn.db'))
const applied = runMigrations(handle, {
  folder: config.migrationsDir,
  backupsDir: join(config.dataDir, 'backups'),
})
console.log(`applied ${applied} migration(s) to ${config.dataDir}`)
handle.sqlite.close()
