import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig } from '../config.ts'
import { openDb } from '../db/index.ts'
import { makeAdmin } from './makeAdmin.ts'

const USAGE = `usage: docker exec cairn node make-admin.js <username>
(dev: npm run make-admin -w @cairn/server -- <username>)`

const args = process.argv.slice(2)
if (args.length !== 1 || args[0]!.startsWith('-')) {
  console.error(USAGE)
  process.exit(2)
}
const username = args[0]!

const config = loadConfig()
mkdirSync(config.dataDir, { recursive: true })
const handle = openDb(join(config.dataDir, 'cairn.db'))
let result
try {
  result = makeAdmin(handle.db, username)
} finally {
  handle.sqlite.close()
}
if (!result.ok) {
  console.error(result.message)
  process.exit(1)
}
console.log(`"${username.toLowerCase()}" is now an admin and can sign in.`)
