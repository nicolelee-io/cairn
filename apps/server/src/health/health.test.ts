import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotifyTestResult, ServerHealth } from '@cairn/shared'
import { memoryDb } from '../test-helpers.ts'
import { checkHealth } from './check.ts'
import { healthMonitor, REMIND_EVERY_MS } from './monitor.ts'
import { notifySettings, sendAlert, type Alert } from './notify.ts'

let dataDir: string
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'cairn-health-'))
})
afterEach(() => rmSync(dataDir, { recursive: true, force: true }))

const writeStatus = (status: object) => {
  mkdirSync(join(dataDir, 'backups'), { recursive: true })
  writeFileSync(join(dataDir, 'backups', 'backup-status.json'), JSON.stringify(status))
}

describe('checkHealth', () => {
  it('is quiet when nothing is set up and all is well', () => {
    const h = checkHealth(memoryDb().db, dataDir)
    expect(h.problems).toEqual([])
    expect(h.databaseWritable).toBe(true)
  })

  it('reports a failed or missed backup, not a missing one', () => {
    const now = Date.now()
    const { db } = memoryDb()
    writeStatus({
      lastRun: { at: now - 1000, ok: false, error: 'repo locked.' },
      lastSuccess: null,
    })
    expect(checkHealth(db, dataDir, now).problems).toEqual([
      { id: 'backup', message: 'The last backup failed: repo locked.' },
    ])
    writeStatus({
      lastRun: { at: now, ok: true, error: null },
      lastSuccess: { at: now - 40 * 3600_000 },
    })
    expect(checkHealth(db, dataDir, now).problems.map((p) => p.id)).toEqual(['backup'])
    writeStatus({
      lastRun: { at: now, ok: true, error: null },
      lastSuccess: { at: now - 3600_000 },
    })
    expect(checkHealth(db, dataDir, now).problems).toEqual([])
  })

  it('flags a database that cannot be written', () => {
    const { db, sqlite } = memoryDb()
    sqlite.pragma('query_only = ON')
    const h = checkHealth(db, dataDir)
    expect(h.databaseWritable).toBe(false)
    expect(h.problems.map((p) => p.id)).toEqual(['database'])
  })
})

describe('healthMonitor', () => {
  const setup = (initial: ServerHealth['problems'] = []) => {
    const state = { problems: initial, on: true, ok: true }
    const send = vi.fn<(alert: Alert) => Promise<NotifyTestResult>>(async () => ({
      ok: state.ok,
      error: null,
    }))
    const monitor = healthMonitor({
      enabled: () => state.on,
      check: (now) => ({
        problems: state.problems,
        databaseWritable: true,
        checkedAt: now,
      }),
      send,
    })
    return { state, send, monitor }
  }
  const problem = { id: 'database' as const, message: 'cannot write' }

  it('announces once, reminds after a day, then says resolved', async () => {
    const { state, send, monitor } = setup([problem])
    await monitor.tick(0)
    await monitor.tick(60_000)
    expect(send).toHaveBeenCalledTimes(1)
    await monitor.tick(REMIND_EVERY_MS)
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1]![0].message).toContain('Still not fixed')
    state.problems = []
    await monitor.tick(REMIND_EVERY_MS + 1)
    expect(send.mock.calls[2]![0].title).toContain('resolved')
    await monitor.tick(REMIND_EVERY_MS + 2)
    expect(send).toHaveBeenCalledTimes(3)
  })

  it('retries a message that failed to send', async () => {
    const { state, send, monitor } = setup([problem])
    state.ok = false
    await monitor.tick(0)
    await monitor.tick(1000)
    expect(send).toHaveBeenCalledTimes(2)
    state.ok = true
    await monitor.tick(2000)
    await monitor.tick(3000)
    expect(send).toHaveBeenCalledTimes(3)
  })

  it('does nothing while off, and reports what is already wrong once switched on', async () => {
    const { state, send, monitor } = setup([problem])
    state.on = false
    await monitor.tick(0)
    expect(send).not.toHaveBeenCalled()
    state.on = true
    await monitor.tick(1000)
    expect(send).toHaveBeenCalledTimes(1)
  })
})

describe('notifications', () => {
  it('keeps the token write-only and the settings round-trip', () => {
    const settings = notifySettings(memoryDb().db)
    expect(settings.view()).toEqual({
      enabled: false,
      url: 'https://ntfy.sh',
      topic: '',
      hasToken: false,
    })
    settings.save({
      enabled: true,
      url: 'https://ntfy.example.com/',
      topic: 'abc',
      token: 'tk_secret',
    })
    expect(settings.view()).toEqual({
      enabled: true,
      url: 'https://ntfy.example.com',
      topic: 'abc',
      hasToken: true,
    })
    expect(JSON.stringify(settings.view())).not.toContain('tk_secret')
    settings.save({ enabled: true, url: 'https://ntfy.example.com', topic: 'abc' })
    expect(settings.read().token).toBe('tk_secret') // absent: kept
    settings.save({ enabled: false, url: 'https://ntfy.example.com', topic: 'abc', token: '' })
    expect(settings.view().hasToken).toBe(false)
  })

  it('posts the message to the topic with the token, and never throws', async () => {
    const fetchImpl = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      async () => new Response('ok'),
    )
    const r = await sendAlert(
      { url: 'https://ntfy.sh', topic: 't', token: 'tk' },
      { title: 'Hi', message: 'body', priority: 4, tags: ['warning'] },
      fetchImpl as unknown as typeof fetch,
    )
    expect(r).toEqual({ ok: true, error: null })
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('https://ntfy.sh/t')
    expect(init!.body).toBe('body')
    expect(init!.headers).toMatchObject({
      Title: 'Hi',
      Priority: '4',
      Tags: 'warning',
      Authorization: 'Bearer tk',
    })

    const bad = await sendAlert(
      { url: 'https://ntfy.sh', topic: 't', token: 'tk' },
      { title: 'x', message: 'y' },
      (async () => new Response('no', { status: 403 })) as unknown as typeof fetch,
    )
    expect(bad).toEqual({ ok: false, error: 'ntfy answered 403' })
    const down = await sendAlert(
      { url: 'https://ntfy.sh', topic: 't', token: 'tk' },
      { title: 'x', message: 'y' },
      (async () => {
        throw new Error('connect ECONNREFUSED with tk')
      }) as unknown as typeof fetch,
    )
    expect(down).toEqual({ ok: false, error: 'Could not reach ntfy' })
  })
})
