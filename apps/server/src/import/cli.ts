import { createWriteStream, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { parseArgs } from 'node:util'
import { loadConfig } from '../config.ts'
import { openDb } from '../db/index.ts'
import { runMigrations } from '../db/migrate.ts'
import { users } from '../db/schema.ts'
import { importDayOne, type ImportReport } from './dayone/run.ts'
import { openExport } from './dayone/source.ts'

const USAGE = `usage: npm run import:journal -- <export.zip|folder|-> [--user <username>] [--archived "Journal Name"]... [--force]

  -         read the zip from stdin (docker exec -i cairn node import-journal.js - < Export.zip);
            it is spooled to imports/ in the data dir and removed afterwards
  --user    required when more than one user exists
  --force   also import entries that were deleted and emptied from the trash (a fresh copy; live
            entries and ones still in the trash are skipped as always)`

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      user: { type: 'string' },
      archived: { type: 'string', multiple: true },
      force: { type: 'boolean', default: false },
    },
  })
  if (positionals.length !== 1) {
    console.error(USAGE)
    process.exit(2)
  }
  const config = loadConfig()
  mkdirSync(config.dataDir, { recursive: true })
  // npm runs workspace scripts from apps/server; INIT_CWD is where the user typed the command.
  const fromStdin = positionals[0] === '-'
  const spool = join(config.dataDir, 'imports', `cli-${process.pid}.zip`)
  const exportPath = fromStdin
    ? spool
    : resolve(process.env.INIT_CWD ?? process.cwd(), positionals[0]!)
  const handle = openDb(join(config.dataDir, 'cairn.db'))
  runMigrations(handle, {
    folder: config.migrationsDir,
    backupsDir: join(config.dataDir, 'backups'),
  })

  const all = handle.db.select().from(users).all()
  const user = values.user ? all.find((u) => u.username === values.user!.toLowerCase()) : all[0]
  if (!user || (!values.user && all.length !== 1)) {
    console.error(
      values.user
        ? `no user "${values.user}"`
        : all.length === 0
          ? 'no users exist; start the server once to create the initial user'
          : 'several users exist; pass --user <username>',
    )
    process.exit(1)
  }

  if (fromStdin) {
    mkdirSync(join(config.dataDir, 'imports'), { recursive: true })
    process.on('exit', () => rmSync(spool, { force: true }))
    await pipeline(process.stdin, createWriteStream(spool))
  }
  console.log(`Importing ${fromStdin ? 'the zip from stdin' : exportPath} into ${config.dataDir} as "${user.username}"`)
  if (values.force) console.log('--force: entries emptied from the trash are imported again')
  const source = await openExport(exportPath)
  let report: ImportReport
  try {
    report = await importDayOne({
      source,
      db: handle.db,
      dataDir: config.dataDir,
      userId: user.id,
      defaultTimezone: user.defaultTimezone,
      archived: values.archived,
      reimportPurged: values.force,
      onProgress: (done, total) => {
        if (done % 100 === 0 || done === total) process.stdout.write(`\r  ${done}/${total}`)
      },
    })
  } finally {
    await source.close()
    handle.sqlite.close()
  }
  process.stdout.write('\n')
  printReport(report)
  if (report.failures.length > 0) process.exit(1)
}

function printReport(r: ImportReport) {
  for (const j of r.journals) {
    console.log(
      `${j.name}${j.archived ? ' (archived)' : ''}: ${j.total} entries, ${j.imported} imported, ${j.skipped} skipped, ${j.failed} failed`,
    )
  }
  console.log(`photos imported: ${r.photosImported}, missing files: ${r.photosMissing}`)
  console.log(
    `attachments imported: ${r.attachmentsImported}, missing files: ${r.attachmentsMissing}`,
  )
  console.log(`broken placeholders removed: ${r.brokenPlaceholders}`)
  const keys = Object.entries(r.unmappedKeys)
  console.log(
    `unmapped entry keys: ${keys.length ? keys.map(([k, n]) => `${k} (${n})`).join(', ') : 'none'}`,
  )
  for (const w of r.warnings) console.log(`  warning: ${w}`)
  for (const f of r.failures) console.log(`  FAILED ${f.journal} ${f.uuid}: ${f.error}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
