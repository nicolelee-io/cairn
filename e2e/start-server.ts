// Starts the app the way production runs it: the built SPA served by the server, on its own port
// and a throwaway data dir. Playwright's webServer runs this; see e2e/CLAUDE.md.
import { execSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { hashPassword } from '../apps/server/src/auth/password.ts'
import { openDb } from '../apps/server/src/db/index.ts'
import { runMigrations } from '../apps/server/src/db/migrate.ts'
import { createUser } from '../apps/server/src/repo/users.ts'
import { seedInitialUser } from '../apps/server/src/seed.ts'
import {
  ACCOUNT_PASSWORD,
  accountUser,
  E2E_PASSWORD,
  E2E_PORT,
  E2E_TIMEZONE,
  E2E_USER,
} from './env.ts'

const root = resolve(import.meta.dirname, '..')
const dataDir = resolve(import.meta.dirname, '.data')

// Every run starts from an empty database; nothing here is ever real journal data.
rmSync(dataDir, { recursive: true, force: true })

// The web build takes about a second, so every run tests the current code.
execSync('npm run build -w @cairn/web', { cwd: root, stdio: 'pipe' }) // output only if it fails

// The users are created here (the server only seeds while the table is empty): the shared one, then
// one per project for the account spec.
mkdirSync(dataDir, { recursive: true })
const handle = openDb(join(dataDir, 'cairn.db'))
runMigrations(handle, { folder: resolve(root, 'apps/server/drizzle') })
await seedInitialUser(handle.db, {
  username: E2E_USER,
  password: E2E_PASSWORD,
  displayName: 'E2E',
  timezone: E2E_TIMEZONE,
})
for (const project of ['phone', 'desktop'])
  createUser(handle.db, {
    username: accountUser(project),
    passwordHash: await hashPassword(ACCOUNT_PASSWORD),
    displayName: 'Account test',
    timezone: E2E_TIMEZONE,
  })
handle.sqlite.close()

Object.assign(process.env, {
  PORT: String(E2E_PORT),
  DATA_DIR: dataDir,
  WEB_DIST: resolve(root, 'apps/web/dist'),
  INITIAL_USERNAME: E2E_USER,
  INITIAL_PASSWORD: E2E_PASSWORD,
  INITIAL_DISPLAY_NAME: 'E2E',
  INITIAL_TIMEZONE: E2E_TIMEZONE,
  GIT_SHA: 'e2e',
})
// Place search and weather stay off: tests never call Google.
delete process.env.GOOGLE_API_KEY

await import('../apps/server/src/index.ts')
