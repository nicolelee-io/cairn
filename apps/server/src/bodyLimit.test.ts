import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp, MAX_JSON_BODY_BYTES } from './app.ts'
import { addUser, memoryDb } from './test-helpers.ts'

const HOST = 'cairn.test'
let app: ReturnType<typeof createApp>
let dataDir: string
let cookie: string

const send = (method: string, path: string, body: string | Uint8Array<ArrayBuffer>, headers = {}) =>
  app.request(path, {
    method,
    headers: { host: HOST, 'content-type': 'application/json', ...headers },
    body,
  })
const login = (password: string) =>
  send('POST', '/api/auth/login', JSON.stringify({ username: 'a', password }))

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'cairn-body-limit-'))
  const { db } = memoryDb()
  await addUser(db, 'a')
  app = createApp({ sha: 'x', db, dataDir })
  cookie = (await login('pw')).headers.get('set-cookie')!.split(';')[0]!
})
afterAll(() => rmSync(dataDir, { recursive: true, force: true }))

describe('request body limit', () => {
  it('refuses an oversized body on the public login, by its size alone', async () => {
    const res = await login('x'.repeat(MAX_JSON_BODY_BYTES))
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'too_large' })
  })

  it('refuses one that only declares its size, without reading it', async () => {
    const res = await send('POST', '/api/auth/login', '{}', {
      'content-length': String(MAX_JSON_BODY_BYTES + 1),
    })
    expect(res.status).toBe(413)
  })

  it('refuses an oversized body on a signed-in route', async () => {
    const res = await send(
      'POST',
      '/api/journals',
      JSON.stringify({ name: 'x'.repeat(MAX_JSON_BODY_BYTES) }),
      { cookie },
    )
    expect(res.status).toBe(413)
  })

  it('leaves the upload routes to their own, larger limits', async () => {
    const big = new Uint8Array(MAX_JSON_BODY_BYTES + 1)
    // Not files these routes take, but they got as far as looking: no 413.
    const attachment = await send('PUT', '/api/attachments?name=a.pdf', big, { cookie })
    expect(attachment.status).toBe(415)
    const avatar = await send('PUT', '/api/avatar', big, { cookie })
    expect(avatar.status).toBe(415)
    const zip = await send('PUT', '/api/import?name=a.zip', big, { cookie })
    expect(zip.status).toBe(415)
    const photo = await send('POST', '/api/photos', big, {
      cookie,
      'content-type': 'multipart/form-data; boundary=x',
    })
    expect(photo.status).not.toBe(413)
  })
})
