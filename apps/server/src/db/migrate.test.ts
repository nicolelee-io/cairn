import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MIGRATIONS } from '../test-helpers.ts'
import { openDb } from './index.ts'
import { runMigrations } from './migrate.ts'

const dirs: string[] = []
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'cairn-test-'))
  dirs.push(d)
  return d
}
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))

describe('runMigrations', () => {
  it('migrates a fresh DB without a snapshot, and is a no-op the second time', () => {
    const dir = tmp()
    const handle = openDb(join(dir, 'cairn.db'))
    const opts = { folder: MIGRATIONS, backupsDir: join(dir, 'backups') }
    expect(runMigrations(handle, opts)).toBeGreaterThan(0)
    expect(runMigrations(handle, opts)).toBe(0)
    expect(() => readdirSync(opts.backupsDir)).toThrow() // never created: nothing to protect
    expect(handle.sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
    handle.sqlite.close()
  })

  it('turns the old 1-5 ratings into mood keys (0013) and leaves unrated entries alone', () => {
    const dir = tmp()
    const handle = openDb(join(dir, 'cairn.db'))
    runMigrations(handle, { folder: MIGRATIONS })
    const { sqlite } = handle
    sqlite
      .prepare(
        "INSERT INTO user (id, username, password_hash, display_name, default_timezone, last_rev, created_at) VALUES ('u','a','h','A','UTC',0,1)",
      )
      .run()
    sqlite
      .prepare(
        "INSERT INTO journal (id, user_id, name, color, sort_order, created_at, updated_at, rev) VALUES ('j','u','J','#000000',0,1,1,1)",
      )
      .run()
    const add = sqlite.prepare(
      "INSERT INTO entry (id, user_id, journal_id, created_at, modified_at, timezone, mood, updated_at, rev) VALUES (?, 'u', 'j', 1, 1, 'UTC', ?, 1, 1)",
    )
    for (const m of [1, 2, 3, 4, 5, null]) add.run(`e${m}`, m)

    // The backfill is the second statement of 0013, run again over the legacy column.
    const sql = readFileSync(join(MIGRATIONS, '0013_mood_key.sql'), 'utf8').split(
      '--> statement-breakpoint',
    )
    sqlite.exec(sql[1]!)
    expect(sqlite.prepare('SELECT id, mood_key AS k FROM entry ORDER BY id').all()).toEqual([
      { id: 'e1', k: 'sad' },
      { id: 'e2', k: 'down' },
      { id: 'e3', k: 'meh' },
      { id: 'e4', k: 'content' },
      { id: 'e5', k: 'happy' },
      { id: 'enull', k: null },
    ])
    sqlite.close()
  })

  it('makes everyone who existed before roles an admin (0015), while new users default to user', () => {
    const dir = tmp()
    const handle = openDb(join(dir, 'cairn.db'))
    runMigrations(handle, { folder: MIGRATIONS })
    const { sqlite } = handle
    const add = sqlite.prepare(
      "INSERT INTO user (id, username, password_hash, display_name, default_timezone, last_rev, created_at) VALUES (?, ?, 'h', 'A', 'UTC', 0, 1)",
    )
    add.run('u1', 'a')
    add.run('u2', 'b')
    // The backfill is the last statement of 0015, run again over users that predate it.
    const sql = readFileSync(join(MIGRATIONS, '0015_user_roles.sql'), 'utf8').split(
      '--> statement-breakpoint',
    )
    sqlite.exec(sql.at(-1)!)
    add.run('u3', 'c')
    expect(sqlite.prepare('SELECT id, role, disabled_at AS d FROM user ORDER BY id').all()).toEqual(
      [
        { id: 'u1', role: 'admin', d: null },
        { id: 'u2', role: 'admin', d: null },
        { id: 'u3', role: 'user', d: null },
      ],
    )
    sqlite.close()
  })

  it('snapshots an already-migrated DB before applying, and throws when a migration fails', () => {
    const dir = tmp()
    const handle = openDb(join(dir, 'cairn.db'))
    const backupsDir = join(dir, 'backups')
    runMigrations(handle, { folder: MIGRATIONS, backupsDir })
    handle.sqlite
      .prepare(
        "INSERT INTO user (id, username, password_hash, display_name, default_timezone, last_rev, created_at) VALUES ('u','a','h','A','UTC',0,1)",
      )
      .run()

    // Make the (only) migration look unapplied: re-running it collides with existing tables,
    // standing in for a migration that fails midway.
    handle.sqlite.exec('DELETE FROM __drizzle_migrations')
    expect(() => runMigrations(handle, { folder: MIGRATIONS, backupsDir })).toThrow()

    const [snap] = readdirSync(backupsDir)
    expect(snap).toMatch(/^pre-migrate-.*\.db$/)
    const copy = openDb(join(backupsDir, snap!))
    expect(copy.sqlite.prepare('SELECT username FROM user').all()).toEqual([{ username: 'a' }])
    copy.sqlite.close()
    handle.sqlite.close()
  })

  it('keeps only the newest snapshots', () => {
    const dir = tmp()
    const handle = openDb(join(dir, 'cairn.db'))
    const backupsDir = join(dir, 'backups')
    runMigrations(handle, { folder: MIGRATIONS, backupsDir })
    let t = Date.UTC(2026, 0, 1)
    for (let i = 0; i < 4; i++) {
      handle.sqlite.exec('DELETE FROM __drizzle_migrations')
      try {
        runMigrations(handle, {
          folder: MIGRATIONS,
          backupsDir,
          keepSnapshots: 2,
          now: () => (t += 1000),
        })
      } catch {
        /* expected: the migration collides with existing tables */
      }
    }
    expect(readdirSync(backupsDir)).toHaveLength(2)
    handle.sqlite.close()
  })
})
