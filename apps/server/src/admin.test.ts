import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app.ts'
import { makeAdmin } from './auth/makeAdmin.ts'
import { findUserByUsername, setDisabled, setRole } from './repo/users.ts'
import { seedInitialUser } from './seed.ts'
import { addUser, memoryDb } from './test-helpers.ts'

const HOST = 'cairn.test'
let app: ReturnType<typeof createApp>
let db: ReturnType<typeof memoryDb>['db']
let dataDir: string

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'cairn-admin-'))
  db = memoryDb().db
  app = createApp({ sha: 'x', db, dataDir, trustProxy: () => true })
})
afterAll(() => rmSync(dataDir, { recursive: true, force: true }))

type Client = (method: string, path: string, body?: unknown) => Promise<Response>

const login = (username: string, password = 'pw', ip = '10.0.0.1') =>
  app.request('/api/auth/login', {
    method: 'POST',
    headers: { host: HOST, 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ username, password }),
  })

function client(cookie: string, ip = '10.0.0.1'): Client {
  return async (method, path, body) =>
    app.request(path, {
      method,
      headers: { host: HOST, cookie, 'x-forwarded-for': ip, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
}

async function signedIn(username: string, password = 'pw'): Promise<Client> {
  const res = await login(username, password)
  expect(res.status).toBe(200)
  return client(res.headers.get('set-cookie')!.split(';')[0]!)
}

const json = async (res: Response) => (await res.json()) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any -- test helper over untyped JSON

describe('roles', () => {
  it('the seeded first user is an admin; Me carries the role', async () => {
    const fresh = memoryDb().db
    const initial = { username: 'Owner', password: 'pw', displayName: 'O', timezone: 'UTC' }
    expect(await seedInitialUser(fresh, initial)).toBe(true)
    expect(findUserByUsername(fresh, 'owner')?.role).toBe('admin')

    await addUser(db, 'role-admin', 'pw', 'admin')
    await addUser(db, 'role-user')
    expect((await json(await login('role-admin'))).role).toBe('admin')
    const u = await signedIn('role-user')
    expect((await json(await u('GET', '/api/auth/me'))).role).toBe('user')
  })

  it('every server-wide and admin route is 403 for a plain user', async () => {
    await addUser(db, 'plain')
    const u = await signedIn('plain')
    const target = (await addUser(db, 'someone')).id
    const gated: [string, string, unknown?][] = [
      ['GET', '/api/places/key'],
      ['PUT', '/api/places/key', { key: 'a-key-of-some-length' }],
      ['DELETE', '/api/places/key'],
      ['PUT', '/api/attachments/limit', { maxMb: 10 }],
      ['GET', '/api/backup/status'],
      ['GET', '/api/admin/users'],
      ['POST', '/api/admin/users', { username: 'x', displayName: 'X', password: 'password1' }],
      ['PATCH', `/api/admin/users/${target}`, { role: 'admin' }],
      ['POST', `/api/admin/users/${target}/password`, { newPassword: 'password1' }],
      ['GET', '/api/admin/storage'],
      ['GET', '/api/admin/cleanup'],
      ['POST', '/api/admin/cleanup'],
      ['GET', '/api/admin/trash'],
      ['PUT', '/api/admin/trash', { retentionDays: 7 }],
      ['POST', '/api/prompts/categories', { name: 'x' }],
      ['POST', '/api/prompts/suggested', { text: 'x' }],
      ['POST', '/api/prompts/suggested/bulk-delete', { ids: ['x'] }],
    ]
    for (const [method, path, body] of gated)
      expect([method, path, (await u(method, path, body)).status]).toEqual([method, path, 403])
    // Every uploader needs the limit, so reading it stays open.
    expect((await u('GET', '/api/attachments/limit')).status).toBe(200)
    expect(findUserByUsername(db, 'someone')?.role).toBe('user')
  })

  it('a demotion takes effect on the next request, without signing in again', async () => {
    const { id } = await addUser(db, 'demoted', 'pw', 'admin')
    const d = await signedIn('demoted')
    expect((await d('GET', '/api/admin/users')).status).toBe(200)
    setRole(db, id, 'user')
    expect((await d('GET', '/api/admin/users')).status).toBe(403)
  })
})

describe('Manage users', () => {
  let admin: Client
  let adminId: string
  beforeAll(async () => {
    adminId = (await addUser(db, 'boss', 'pw', 'admin')).id
    admin = await signedIn('boss')
  })

  it('lists users with account fields only', async () => {
    const body = await json(await admin('GET', '/api/admin/users'))
    const me = body.users.find((u: { id: string }) => u.id === adminId)
    expect(me).toEqual({
      id: adminId,
      username: 'boss',
      displayName: 'boss',
      role: 'admin',
      disabled: false,
      createdAt: expect.any(Number),
    })
    expect(Object.keys(me)).not.toContain('passwordHash')
  })

  it('creates a user who can sign in with the temporary password, in the admin timezone', async () => {
    const res = await admin('POST', '/api/admin/users', {
      username: 'Kid',
      displayName: 'Kid',
      password: 'temporary1',
    })
    expect(res.status).toBe(201)
    expect(await json(res)).toMatchObject({ username: 'kid', role: 'user', disabled: false })
    const me = await json(await login('kid', 'temporary1'))
    expect(me).toMatchObject({ username: 'kid', role: 'user', defaultTimezone: 'America/Denver' })

    const taken = await admin('POST', '/api/admin/users', {
      username: 'KID',
      displayName: 'Other',
      password: 'temporary1',
    })
    expect(taken.status).toBe(409)
    expect(await json(taken)).toEqual({ error: 'username_taken' })
    const weak = { username: 'weak', displayName: 'W', password: 'short' }
    expect((await admin('POST', '/api/admin/users', weak)).status).toBe(400)
  })

  it('creates an admin when asked, and changes roles both ways', async () => {
    const made = await json(
      await admin('POST', '/api/admin/users', {
        username: 'second',
        displayName: 'Second',
        password: 'password1',
        role: 'admin',
      }),
    )
    expect(made.role).toBe('admin')
    const down = await admin('PATCH', `/api/admin/users/${made.id}`, { role: 'user' })
    expect(await json(down)).toMatchObject({ role: 'user' })
    const up = await admin('PATCH', `/api/admin/users/${made.id}`, { role: 'admin' })
    expect(await json(up)).toMatchObject({ role: 'admin' })
    expect((await admin('PATCH', `/api/admin/users/${made.id}`, {})).status).toBe(400)
    expect((await admin('PATCH', '/api/admin/users/nope', { role: 'user' })).status).toBe(404)
  })

  it('disabling ends the sessions and stops sign-in; enabling lets them back', async () => {
    const { id } = await addUser(db, 'paused')
    const p = await signedIn('paused')
    const res = await admin('PATCH', `/api/admin/users/${id}`, { disabled: true })
    expect(await json(res)).toMatchObject({ disabled: true })
    expect((await p('GET', '/api/auth/me')).status).toBe(401)

    const refused = await login('paused')
    expect(refused.status).toBe(403)
    expect(await json(refused)).toEqual({ error: 'account_disabled' })
    // A wrong password still looks like any other wrong password.
    expect((await login('paused', 'wrong')).status).toBe(401)

    await admin('PATCH', `/api/admin/users/${id}`, { disabled: false })
    expect((await login('paused')).status).toBe(200)
  })

  it('a session that outlives the disable (set out of band) is refused and dropped', async () => {
    const { id } = await addUser(db, 'sneaky')
    const s = await signedIn('sneaky')
    setDisabled(db, id, true)
    expect((await s('GET', '/api/journals')).status).toBe(401)
    setDisabled(db, id, false)
    expect((await s('GET', '/api/journals')).status).toBe(401) // the session itself is gone
  })

  it('resets a password: the old one stops working and every session ends', async () => {
    const { id } = await addUser(db, 'forgetful', 'old-password')
    const f = await signedIn('forgetful', 'old-password')
    const res = await admin('POST', `/api/admin/users/${id}/password`, {
      newPassword: 'new-password',
    })
    expect(res.status).toBe(200)
    expect((await f('GET', '/api/auth/me')).status).toBe(401)
    expect((await login('forgetful', 'old-password')).status).toBe(401)
    expect((await login('forgetful', 'new-password')).status).toBe(200)
    const short = { newPassword: 'short' }
    expect((await admin('POST', `/api/admin/users/${id}/password`, short)).status).toBe(400)
  })

  it('a reset lifts a sign-in lockout on the name', async () => {
    const { id } = await addUser(db, 'locked', 'right-password')
    // 30 failures per username per window, from many IPs so the per-IP limit isn't what bites.
    for (let i = 0; i < 30; i++) await login('locked', 'wrong', `10.1.0.${i}`)
    expect((await login('locked', 'right-password', '10.2.0.1')).status).toBe(429)
    await admin('POST', `/api/admin/users/${id}/password`, { newPassword: 'fresh-password' })
    expect((await login('locked', 'fresh-password', '10.2.0.1')).status).toBe(200)
  })

  it("an admin can't change their own role, state or password here", async () => {
    for (const body of [{ role: 'user' }, { disabled: true }]) {
      const res = await admin('PATCH', `/api/admin/users/${adminId}`, body)
      expect(res.status).toBe(409)
      expect(await json(res)).toEqual({ error: 'self' })
    }
    const pw = await admin('POST', `/api/admin/users/${adminId}/password`, {
      newPassword: 'password1',
    })
    expect(pw.status).toBe(409)
    expect(findUserByUsername(db, 'boss')).toMatchObject({ role: 'admin', disabledAt: null })
  })

  it('make-admin (the CLI core) promotes and re-enables, for a server with no admin left', async () => {
    const { id } = await addUser(db, 'rescued')
    setDisabled(db, id, true)
    expect(makeAdmin(db, ' Rescued ')).toEqual({ ok: true })
    expect(findUserByUsername(db, 'rescued')).toMatchObject({ role: 'admin', disabledAt: null })
    expect(makeAdmin(db, 'nobody')).toMatchObject({ ok: false })
  })
})

describe("admins get no route to another user's content", () => {
  it("an admin can't read B's journals, entries, photos, attachments or avatar", async () => {
    await addUser(db, 'owner-b')
    await addUser(db, 'nosy', 'pw', 'admin')
    const b = await signedIn('owner-b')
    const nosy = await signedIn('nosy')

    const journal = await json(
      await b('POST', '/api/journals', { name: 'Private', color: '#336699' }),
    )
    const { entry } = await json(
      await b('POST', '/api/entries', {
        journalId: journal.id,
        bodyMd: 'secret words',
        timezone: 'UTC',
      }),
    )
    expect(entry.id).toBeTruthy()
    const cookieB = (await login('owner-b')).headers.get('set-cookie')!.split(';')[0]!
    const png = await sharp({
      create: { width: 20, height: 20, channels: 3, background: '#ff0000' },
    })
      .png()
      .toBuffer()
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'p.png')
    const photo = await json(
      await app.request('/api/photos', {
        method: 'POST',
        headers: { host: HOST, cookie: cookieB },
        body: form,
      }),
    )
    const file = await json(
      await app.request('/api/attachments?name=f.pdf', {
        method: 'PUT',
        headers: { host: HOST, cookie: cookieB, 'content-type': 'application/octet-stream' },
        body: new Uint8Array(Buffer.from('%PDF-1.4\nhello pdf\n%%EOF\n')),
      }),
    )
    expect(photo.id && file.id).toBeTruthy()

    for (const path of [
      `/api/journals/${journal.id}`,
      `/api/entries/${entry.id}`,
      `/api/photos/${photo.id}/original`,
      `/api/attachments/${file.id}`,
    ])
      expect([path, (await nosy('GET', path)).status]).toEqual([path, 404])
    expect(JSON.stringify(await json(await nosy('GET', '/api/journals')))).not.toContain('Private')
    const found = await json(await nosy('GET', '/api/search?q=secret'))
    expect(JSON.stringify(found)).not.toContain(entry.id)
    // Nor in the trash: B's deleted entry is neither listed, restorable nor purgeable.
    expect((await b('DELETE', `/api/entries/${entry.id}`)).status).toBe(204)
    expect(JSON.stringify(await json(await nosy('GET', '/api/trash/entries')))).not.toContain(
      entry.id,
    )
    expect((await nosy('POST', `/api/trash/entries/${entry.id}/restore`)).status).toBe(404)
    expect((await nosy('DELETE', `/api/trash/entries/${entry.id}`)).status).toBe(404)
    expect((await b('POST', `/api/trash/entries/${entry.id}/restore`)).status).toBe(200)
    // The avatar route has no id: it only ever serves the caller's own picture.
    expect((await nosy('GET', '/api/avatar')).status).toBe(404)
    // Nor does Manage users carry anything about B's journals.
    const listed = await json(await nosy('GET', '/api/admin/users'))
    expect(JSON.stringify(listed)).not.toContain('Private')
    // Storage gives B's totals (the photo and PDF, never saved into an entry, wait for cleanup)
    // but nothing about B's journals.
    const storage = await nosy('GET', '/api/admin/storage')
    expect(storage.status).toBe(200)
    const report = await json(storage)
    const ofB = report.users.find((u: { username: string }) => u.username === 'owner-b')
    expect(ofB.pendingBytes).toBeGreaterThan(0)
    expect(Object.keys(ofB).some((k) => /journal/i.test(k))).toBe(false)
    for (const leak of ['Private', journal.id, entry.id, photo.id, file.id])
      expect(JSON.stringify(report)).not.toContain(leak)
    // And B's own report names the journal by id, for B.
    const own = await json(await b('GET', '/api/storage'))
    expect(own.journals.map((j: { journalId: string }) => j.journalId)).toEqual([journal.id])
    // The cleanup is counts only, and its preview changes nothing.
    const preview = await nosy('GET', '/api/admin/cleanup')
    expect(preview.status).toBe(200)
    const counts = await json(preview)
    expect(counts.dryRun).toBe(true)
    expect(
      Object.values(counts).every((v) => typeof v === 'number' || typeof v === 'boolean'),
    ).toBe(true)
    const run = await json(await nosy('POST', '/api/admin/cleanup'))
    expect(run.dryRun).toBe(false)
    for (const leak of ['Private', journal.id, entry.id, photo.id, file.id, 'missingPaths'])
      expect(JSON.stringify([counts, run])).not.toContain(leak)
    // B's uploads are minutes old, so the run left them for B to save.
    expect((await b('GET', `/api/photos/${photo.id}/thumb`)).status).toBe(200)
  })
})

describe('trash retention', () => {
  it('admins set it from the allowed choices; everyone sees it in /me', async () => {
    await addUser(db, 'keeper', 'pw', 'admin')
    await addUser(db, 'reader')
    const admin = await signedIn('keeper')
    const reader = await signedIn('reader')
    expect(await json(await admin('GET', '/api/admin/trash'))).toEqual({ retentionDays: 60 })
    expect((await admin('PUT', '/api/admin/trash', { retentionDays: 8 })).status).toBe(400)
    expect(await json(await admin('PUT', '/api/admin/trash', { retentionDays: 30 }))).toEqual({
      retentionDays: 30,
    })
    expect((await json(await reader('GET', '/api/auth/me'))).trashRetentionDays).toBe(30)
  })
})
