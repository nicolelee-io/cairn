import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.ts'
import { addUser, memoryDb } from '../test-helpers.ts'
import { readBackupStatus, STALE_AFTER_MS, statusFile } from './status.ts'

const NOW = Date.UTC(2026, 9, 30, 12)
const HOUR = 60 * 60 * 1000

let dataDir: string
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'cairn-backup-status-'))
  mkdirSync(join(dataDir, 'backups'))
})
const write = (body: unknown) =>
  writeFileSync(statusFile(dataDir), typeof body === 'string' ? body : JSON.stringify(body))

const ok = (hoursAgo: number, now = NOW) => ({
  lastRun: { at: now - hoursAgo * HOUR, ok: true, error: null },
  lastSuccess: { at: now - hoursAgo * HOUR, snapshotId: 'abc123' },
})

describe('readBackupStatus', () => {
  it('is "none" until the sidecar has reported, or when the file is unusable', () => {
    expect(readBackupStatus(dataDir, NOW).state).toBe('none') // no file
    for (const body of ['', 'not json', '[]', '{}', '{"lastRun":"yesterday"}']) {
      write(body)
      expect(readBackupStatus(dataDir, NOW).state).toBe('none')
    }
  })

  it('is "ok" after a recent success', () => {
    write(ok(3))
    expect(readBackupStatus(dataDir, NOW)).toMatchObject({
      state: 'ok',
      lastSuccessAt: NOW - 3 * HOUR,
      snapshotId: 'abc123',
      lastRunError: null,
    })
  })

  it('is "stale" when the last success is older than a missed night', () => {
    write(ok(STALE_AFTER_MS / HOUR + 1))
    expect(readBackupStatus(dataDir, NOW).state).toBe('stale')
    write(ok(STALE_AFTER_MS / HOUR - 1))
    expect(readBackupStatus(dataDir, NOW).state).toBe('ok')
  })

  it('is "failing" when the latest attempt failed, with its error, even over an old success', () => {
    write({
      lastRun: { at: NOW - HOUR, ok: false, error: 'repository is locked' },
      lastSuccess: { at: NOW - 80 * HOUR, snapshotId: 'old' },
    })
    expect(readBackupStatus(dataDir, NOW)).toMatchObject({
      state: 'failing',
      lastRunError: 'repository is locked',
      lastSuccessAt: NOW - 80 * HOUR,
    })
  })

  it('is "failing" on a first attempt that failed (no success yet)', () => {
    write({ lastRun: { at: NOW, ok: false, error: 'bad password' }, lastSuccess: null })
    expect(readBackupStatus(dataDir, NOW)).toMatchObject({ state: 'failing', lastSuccessAt: null })
  })

  it('reports the last test restore', () => {
    write({ ...ok(1), lastVerify: { at: NOW - 24 * HOUR, ok: true, error: null } })
    expect(readBackupStatus(dataDir, NOW)).toMatchObject({
      lastVerifyAt: NOW - 24 * HOUR,
      lastVerifyOk: true,
      lastVerifyError: null,
    })
    write({ ...ok(1), lastVerify: { at: NOW, ok: false, error: '2 photo files missing' } })
    expect(readBackupStatus(dataDir, NOW)).toMatchObject({
      lastVerifyOk: false,
      lastVerifyError: '2 photo files missing',
    })
  })

  it('tolerates fields it does not know and ones that are the wrong type', () => {
    write({
      ...ok(2),
      somethingNew: { a: 1 },
      lastVerify: { at: 'tuesday', ok: 'yes' },
    })
    expect(readBackupStatus(dataDir, NOW)).toMatchObject({ state: 'ok', lastVerifyAt: null })
  })
})

describe('the files the backup scripts write (backup/test/fixtures, shared with run.sh)', () => {
  const fixture = (name: string) =>
    readFileSync(resolve(import.meta.dirname, '../../../../backup/test/fixtures', name), 'utf8')
  const atOf = (body: string, key: 'lastRun' | 'lastSuccess') =>
    (JSON.parse(body) as Record<typeof key, { at: number }>)[key].at

  it('reads a successful backup and test restore', () => {
    const body = fixture('status-ok.json')
    write(body)
    const at = atOf(body, 'lastSuccess')
    expect(readBackupStatus(dataDir, at + HOUR)).toEqual({
      state: 'ok',
      lastRunAt: at,
      lastRunError: null,
      lastSuccessAt: at,
      snapshotId: 'b22ff394',
      lastVerifyAt: at + 60_000,
      lastVerifyOk: true,
      lastVerifyError: null,
    })
  })

  it('reads a failed run after an earlier success', () => {
    const body = fixture('status-failing.json')
    write(body)
    expect(readBackupStatus(dataDir, atOf(body, 'lastRun') + HOUR)).toMatchObject({
      state: 'failing',
      lastRunError: 'Fatal: unable to open repository ("quoted" and \\ backslash)',
      lastSuccessAt: atOf(body, 'lastSuccess'),
      snapshotId: 'b22ff394',
    })
  })
})

describe('GET /api/backup/status', () => {
  // Its own data dir: the one above is recreated before every test.
  const appDir = mkdtempSync(join(tmpdir(), 'cairn-backup-route-'))
  let app: ReturnType<typeof createApp>
  let cookie: string
  beforeAll(async () => {
    mkdirSync(join(appDir, 'backups'))
    const { db } = memoryDb()
    await addUser(db, 'alice', 'correct horse', 'admin')
    app = createApp({ sha: 'abc', db, dataDir: appDir })
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { host: 'cairn.test', 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'correct horse' }),
    })
    cookie = res.headers.get('set-cookie')!.split(';')[0]!
  })
  afterAll(() => rmSync(appDir, { recursive: true, force: true }))

  it('needs a session', async () => {
    expect((await app.request('/api/backup/status')).status).toBe(401)
  })

  it('serves the status, and "none" before there is one', async () => {
    const get = async () =>
      (await app.request('/api/backup/status', { headers: { host: 'cairn.test', cookie } })).json()
    expect(await get()).toMatchObject({ state: 'none' })
    writeFileSync(statusFile(appDir), JSON.stringify(ok(1, Date.now())))
    expect(await get()).toMatchObject({ state: 'ok', snapshotId: 'abc123' })
  })
})
