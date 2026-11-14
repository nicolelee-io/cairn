import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app.ts'
import { resetPassword } from './auth/resetPassword.ts'
import { avatarPath } from './photos/avatar.ts'
import { addUser, memoryDb } from './test-helpers.ts'

const HOST = 'cairn.test'
let app: ReturnType<typeof createApp>
let db: ReturnType<typeof memoryDb>['db']
let dataDir: string

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'cairn-account-'))
  db = memoryDb().db
  app = createApp({ sha: 'x', db, dataDir, trustProxy: () => true })
})
afterAll(() => rmSync(dataDir, { recursive: true, force: true }))

type Client = (method: string, path: string, body?: unknown, raw?: Buffer) => Promise<Response>

async function login(username: string, password: string, ip = '10.0.0.1') {
  return app.request('/api/auth/login', {
    method: 'POST',
    headers: { host: HOST, 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ username, password }),
  })
}

async function signedIn(username: string, password = 'pw', ip = '10.0.0.1'): Promise<Client> {
  const res = await login(username, password, ip)
  const cookie = res.headers.get('set-cookie')!.split(';')[0]!
  return async (method, path, body, raw) =>
    app.request(path, {
      method,
      headers: {
        host: HOST,
        cookie,
        'x-forwarded-for': ip,
        ...(raw ? { 'content-type': 'image/png' } : { 'content-type': 'application/json' }),
      },
      body: raw ? new Uint8Array(raw) : body === undefined ? undefined : JSON.stringify(body),
    })
}

const json = async (res: Response) => (await res.json()) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any -- test helper over untyped JSON

const png = (w = 40, h = 20) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#a33' } })
    .png()
    .toBuffer()

describe('profile (PATCH /me)', () => {
  it('trims and validates the display name', async () => {
    await addUser(db, 'prof')
    const c = await signedIn('prof')
    const ok = await c('PATCH', '/api/auth/me', { displayName: '  Nicky  ' })
    expect(ok.status).toBe(200)
    expect((await json(ok)).displayName).toBe('Nicky')
    expect((await c('PATCH', '/api/auth/me', { displayName: '   ' })).status).toBe(400)
    expect((await c('PATCH', '/api/auth/me', { displayName: 'x'.repeat(101) })).status).toBe(400)
  })

  it('accepts an IANA zone and rejects a bad one', async () => {
    const c = await signedIn('prof')
    const ok = await c('PATCH', '/api/auth/me', { defaultTimezone: 'Europe/Paris' })
    expect((await json(ok)).defaultTimezone).toBe('Europe/Paris')
    for (const bad of ['Mars/Olympus', '', 'not a zone'])
      expect((await c('PATCH', '/api/auth/me', { defaultTimezone: bad })).status).toBe(400)
    expect((await json(await c('GET', '/api/auth/me'))).defaultTimezone).toBe('Europe/Paris')
  })
})

describe('credentials (POST /auth/credentials)', () => {
  it('needs the current password; a wrong one is 403 and rate limited', async () => {
    await addUser(db, 'guess', 'right-password')
    const c = await signedIn('guess', 'right-password', '10.0.1.1')
    for (let i = 0; i < 8; i++) {
      const res = await c('POST', '/api/auth/credentials', {
        currentPassword: 'wrong',
        newPassword: 'whatever-123',
      })
      expect(res.status).toBe(403)
      expect((await json(res)).error).toBe('wrong_password')
    }
    // The ninth try is refused outright, even with the right password, and so is login.
    const limited = await c('POST', '/api/auth/credentials', {
      currentPassword: 'right-password',
      newPassword: 'whatever-123',
    })
    expect(limited.status).toBe(429)
    expect((await login('guess', 'right-password', '10.0.1.1')).status).toBe(429)
  })

  it('validates the new password and the username', async () => {
    await addUser(db, 'valid')
    const c = await signedIn('valid', 'pw', '10.0.2.1')
    const post = (b: object) => c('POST', '/api/auth/credentials', { currentPassword: 'pw', ...b })
    expect((await post({ newPassword: 'short' })).status).toBe(400)
    expect((await post({ username: '   ' })).status).toBe(400)
    expect((await post({})).status).toBe(400)
    expect(
      (await c('POST', '/api/auth/credentials', { newPassword: 'long-enough-1' })).status,
    ).toBe(400)
  })

  it('changes the password: old one stops working, other sessions end, this one stays', async () => {
    await addUser(db, 'pwuser', 'old-password')
    const here = await signedIn('pwuser', 'old-password', '10.0.3.1')
    const elsewhere = await signedIn('pwuser', 'old-password', '10.0.3.2')
    expect((await elsewhere('GET', '/api/auth/me')).status).toBe(200)

    const res = await here('POST', '/api/auth/credentials', {
      currentPassword: 'old-password',
      newPassword: 'new-password-1',
    })
    expect(res.status).toBe(200)

    expect((await here('GET', '/api/auth/me')).status).toBe(200)
    expect((await elsewhere('GET', '/api/auth/me')).status).toBe(401)
    expect((await login('pwuser', 'old-password', '10.0.3.3')).status).toBe(401)
    expect((await login('pwuser', 'new-password-1', '10.0.3.3')).status).toBe(200)
  })

  it('a username change keeps other sessions and lowercases', async () => {
    await addUser(db, 'rename')
    const here = await signedIn('rename', 'pw', '10.0.4.1')
    const elsewhere = await signedIn('rename', 'pw', '10.0.4.2')
    const res = await here('POST', '/api/auth/credentials', {
      currentPassword: 'pw',
      username: '  Renamed ',
    })
    expect(res.status).toBe(200)
    expect((await json(res)).username).toBe('renamed')
    expect((await elsewhere('GET', '/api/auth/me')).status).toBe(200)
    expect((await login('RENAMED', 'pw', '10.0.4.3')).status).toBe(200)
    expect((await login('rename', 'pw', '10.0.4.3')).status).toBe(401)
  })

  it('refuses a taken username with 409, whatever its case', async () => {
    await addUser(db, 'taken')
    await addUser(db, 'wants')
    const c = await signedIn('wants', 'pw', '10.0.5.1')
    const res = await c('POST', '/api/auth/credentials', {
      currentPassword: 'pw',
      username: 'TAKEN',
    })
    expect(res.status).toBe(409)
    expect((await json(res)).error).toBe('username_taken')
    expect((await json(await c('GET', '/api/auth/me'))).username).toBe('wants')
  })
})

describe('avatar', () => {
  it('uploads a square 256px WebP, replaces it, and deletes it', async () => {
    const a = (await addUser(db, 'avatar-a')).id
    const c = await signedIn('avatar-a', 'pw', '10.0.6.1')
    expect((await c('GET', '/api/avatar')).status).toBe(404)

    const up = await c('PUT', '/api/avatar', undefined, await png(300, 100))
    expect(up.status).toBe(200)
    const first = (await json(up)).avatarUpdatedAt as number
    expect(first).toBeGreaterThan(0)
    expect(existsSync(join(dataDir, avatarPath(a)))).toBe(true)

    const got = await c('GET', '/api/avatar?v=' + first)
    expect(got.status).toBe(200)
    expect(got.headers.get('content-type')).toBe('image/webp')
    expect(got.headers.get('cache-control')).toContain('immutable')
    const meta = await sharp(Buffer.from(await got.arrayBuffer())).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 256, 256])

    const again = await c('PUT', '/api/avatar', undefined, await png(50, 50))
    expect((await json(again)).avatarUpdatedAt).toBeGreaterThan(first)

    const del = await c('DELETE', '/api/avatar')
    expect(del.status).toBe(200)
    expect((await json(del)).avatarUpdatedAt).toBeNull()
    expect(existsSync(join(dataDir, avatarPath(a)))).toBe(false)
    expect((await c('GET', '/api/avatar')).status).toBe(404)
  })

  it('rejects other types, junk and oversize', async () => {
    await addUser(db, 'avatar-bad')
    const c = await signedIn('avatar-bad', 'pw', '10.0.7.1')
    const gif = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } })
      .gif()
      .toBuffer()
    expect((await c('PUT', '/api/avatar', undefined, gif)).status).toBe(415)
    expect((await c('PUT', '/api/avatar', undefined, Buffer.from('not an image'))).status).toBe(415)
    expect((await c('PUT', '/api/avatar', undefined, Buffer.alloc(0))).status).toBe(400)
    expect(
      (await c('PUT', '/api/avatar', undefined, Buffer.alloc(10 * 1024 * 1024 + 1))).status,
    ).toBe(413)
    expect((await json(await c('GET', '/api/auth/me'))).avatarUpdatedAt).toBeNull()
  })

  it("one user can't read, replace or delete another's avatar", async () => {
    await addUser(db, 'owner')
    await addUser(db, 'other')
    const owner = await signedIn('owner', 'pw', '10.0.8.1')
    const other = await signedIn('other', 'pw', '10.0.8.2')
    await owner('PUT', '/api/avatar', undefined, await png())
    const ownerBytes = Buffer.from(await (await owner('GET', '/api/avatar')).arrayBuffer())

    // No id in any path, so the other user only ever reaches their own (empty) slot.
    expect((await other('GET', '/api/avatar')).status).toBe(404)
    await other('DELETE', '/api/avatar')
    const red = await sharp({ create: { width: 9, height: 9, channels: 3, background: '#00f' } })
      .png()
      .toBuffer()
    await other('PUT', '/api/avatar', undefined, red)
    await other('DELETE', '/api/avatar')

    const after = Buffer.from(await (await owner('GET', '/api/avatar')).arrayBuffer())
    expect(after.equals(ownerBytes)).toBe(true)
    expect((await app.request('/api/avatar', { headers: { host: HOST } })).status).toBe(401)
  })
})

describe('reset-password CLI core', () => {
  it('sets the password, ends every session, and applies the app rules', async () => {
    await addUser(db, 'forgot', 'forgotten')
    await addUser(db, 'bystander')
    const bystander = await signedIn('bystander', 'pw', '10.0.9.9')
    const c = await signedIn('forgot', 'forgotten', '10.0.9.1')
    expect((await c('GET', '/api/auth/me')).status).toBe(200)

    expect(await resetPassword(db, 'forgot', 'short')).toMatchObject({
      ok: false,
      reason: 'weak_password',
    })
    expect(await resetPassword(db, 'nobody', 'long-enough-1')).toMatchObject({
      ok: false,
      reason: 'no_such_user',
    })
    expect((await c('GET', '/api/auth/me')).status).toBe(200)

    expect(await resetPassword(db, 'FORGOT', 'brand-new-pass')).toEqual({ ok: true })
    expect((await c('GET', '/api/auth/me')).status).toBe(401)
    expect((await login('forgot', 'forgotten', '10.0.9.2')).status).toBe(401)
    expect((await login('forgot', 'brand-new-pass', '10.0.9.2')).status).toBe(200)
    expect((await bystander('GET', '/api/auth/me')).status).toBe(200)
  })
})
