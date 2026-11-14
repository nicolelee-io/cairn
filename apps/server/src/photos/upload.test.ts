import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../app.ts'
import { eq } from 'drizzle-orm'
import { entries } from '../db/schema.ts'
import { createRepos } from '../repo/index.ts'
import { addUser, memoryDb } from '../test-helpers.ts'
import { photoQuality } from './quality.ts'

const HOST = 'cairn.test'
let app: ReturnType<typeof createApp>
let db: ReturnType<typeof memoryDb>['db']
let dataDir: string
let aId: string
let a: string // cookies
let b: string
let journal: string

async function login(username: string) {
  const res = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { host: HOST, 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'pw' }),
  })
  return res.headers.get('set-cookie')!.split(';')[0]!
}

const png = (color: string) =>
  sharp({ create: { width: 3000, height: 2000, channels: 3, background: color } })
    .png()
    .toBuffer()

function upload(cookie: string, bytes: Buffer, name = 'p.png') {
  const form = new FormData()
  form.set('file', new File([new Uint8Array(bytes)], name))
  return app.request('/api/photos', {
    method: 'POST',
    headers: { host: HOST, cookie },
    body: form,
  })
}
const api = (cookie: string, method: string, path: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { host: HOST, cookie, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'cairn-upload-'))
  db = memoryDb().db
  photoQuality(db).set('original') // the compressed setting has its own tests
  aId = (await addUser(db, 'a')).id
  await addUser(db, 'b')
  app = createApp({ sha: 'x', db, dataDir })
  a = await login('a')
  b = await login('b')
  journal = createRepos(db, aId).journals.create({ name: 'J' }).id
})
afterAll(() => rmSync(dataDir, { recursive: true, force: true }))

const newEntry = async (bodyMd: string) => {
  const res = await api(a, 'POST', '/api/entries', { journalId: journal, timezone: 'UTC', bodyMd })
  expect(res.status).toBe(201)
  return ((await res.json()) as { entry: { id: string; rev: number } }).entry
}
const detail = async (id: string) =>
  (await (await api(a, 'GET', `/api/entries/${id}`)).json()) as {
    entry: { bodyMd: string; rev: number }
    photos: { id: string; position: number }[]
  }
const up = async (color: string) =>
  ((await (await upload(a, await png(color))).json()) as { id: string }).id

describe('POST /api/photos', () => {
  it('stores the original and WebP derivatives, and serves them to the owner only', async () => {
    const res = await upload(a, await png('#336699'))
    expect(res.status).toBe(201)
    const photo = (await res.json()) as { id: string; width: number; height: number }
    expect(photo).toMatchObject({ width: 3000, height: 2000 })

    const row = createRepos(db, aId).photos.get(photo.id)!
    for (const p of [row.originalPath, row.displayPath!, row.thumbPath!])
      expect(existsSync(join(dataDir, p))).toBe(true)
    expect(row.entryId).toBeNull()
    expect(row.originalPath).toMatch(/^photos\/[^/]+\/originals\/[0-9a-f]{64}\.png$/)

    const display = await api(a, 'GET', `/api/photos/${photo.id}/display`)
    expect(display.headers.get('content-type')).toBe('image/webp')
    expect((await sharp(Buffer.from(await display.arrayBuffer())).metadata()).width).toBe(2048)
    expect((await api(b, 'GET', `/api/photos/${photo.id}/display`)).status).toBe(404)
  })

  it.each(['gif', 'avif', 'tiff'] as const)(
    'takes a %s and makes WebP derivatives',
    async (fmt) => {
      const img = sharp({ create: { width: 600, height: 400, channels: 3, background: '#336699' } })
      const bytes = await img[fmt]().toBuffer()
      const res = await upload(a, bytes, `p.${fmt}`)
      expect(res.status).toBe(201)
      const photo = (await res.json()) as {
        id: string
        width: number
        height: number
        mime: string
      }
      expect([photo.width, photo.height]).toEqual([600, 400])
      const thumb = await api(a, 'GET', `/api/photos/${photo.id}/thumb`)
      expect(thumb.headers.get('content-type')).toBe('image/webp')
      const original = await api(a, 'GET', `/api/photos/${photo.id}/original`)
      expect(original.headers.get('content-type')).toBe(`image/${fmt}`)
    },
  )

  it('rejects non-images, unsupported formats and a missing file', async () => {
    const text = await upload(a, Buffer.from('not an image'), 'x.jpg')
    expect(text.status).toBe(415)
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>')
    const res = await upload(a, svg, 'x.svg')
    expect(res.status).toBe(415)
    expect(((await res.json()) as { message: string }).message).toMatch(/JPEG, PNG, WebP/)
    const none = await app.request('/api/photos', {
      method: 'POST',
      headers: { host: HOST, cookie: a },
      body: new FormData(),
    })
    expect(none.status).toBe(400)
  })

  it('requires a session', async () => {
    const res = await app.request('/api/photos', { method: 'POST', headers: { host: HOST } })
    expect(res.status).toBe(401)
  })
})

describe('photos and entry text', () => {
  it('attaches uploads when the entry that references them is created, in body order', async () => {
    const [p1, p2] = [await up('#111111'), await up('#222222')]
    const e = await newEntry(`first\n\n![](photo:${p2})\n\n![](photo:${p1})`)
    const d = await detail(e.id)
    expect(d.photos.map((p) => [p.id, p.position])).toEqual([
      [p2, 0],
      [p1, 1],
    ])
  })

  it('reorders when the text is reordered and tombstones photos removed from the text', async () => {
    const [p1, p2, p3] = [await up('#333333'), await up('#444444'), await up('#555555')]
    const e = await newEntry(`![](photo:${p1})\n\n![](photo:${p2})\n\n![](photo:${p3})`)

    const res = await api(a, 'PATCH', `/api/entries/${e.id}`, {
      bodyMd: `![](photo:${p3})\n\n![](photo:${p1})`,
      baseRev: e.rev,
    })
    expect(res.status).toBe(200)
    const d = await detail(e.id)
    expect(d.photos.map((p) => p.id)).toEqual([p3, p1])
    expect((await api(a, 'GET', `/api/photos/${p2}/thumb`)).status).toBe(404)

    // A tombstoned photo can't be revived by pasting its reference back.
    await api(a, 'PATCH', `/api/entries/${e.id}`, {
      bodyMd: `![](photo:${p3})\n\n![](photo:${p1})\n\n![](photo:${p2})`,
      baseRev: d.entry.rev,
    })
    expect((await detail(e.id)).photos.map((p) => p.id)).toEqual([p3, p1])
  })

  it("won't attach another user's photo, or one already on another entry", async () => {
    const mine = await up('#666666')
    const e1 = await newEntry(`![](photo:${mine})`)
    const e2 = await newEntry(`![](photo:${mine})`)
    expect((await detail(e1.id)).photos).toHaveLength(1)
    expect((await detail(e2.id)).photos).toHaveLength(0)

    const theirs = ((await (await upload(b, await png('#777777'))).json()) as { id: string }).id
    const e3 = await newEntry(`![](photo:${theirs})`)
    expect((await detail(e3.id)).photos).toHaveLength(0)
    expect((await api(b, 'GET', `/api/photos/${theirs}/thumb`)).status).toBe(200)
  })
})

describe('DELETE /api/photos/:id', () => {
  it('tombstones an attached photo and strips it from the text, keeping the file', async () => {
    const id = await up('#888888')
    const e = await newEntry(`before\n\n![](photo:${id})\n\nafter`)
    const row = createRepos(db, aId).photos.get(id)!

    expect((await api(b, 'DELETE', `/api/photos/${id}`)).status).toBe(404)
    expect((await api(a, 'DELETE', `/api/photos/${id}`)).status).toBe(204)
    expect((await api(a, 'DELETE', `/api/photos/${id}`)).status).toBe(404)

    const d = await detail(e.id)
    expect(d.entry.bodyMd).toBe('before\n\nafter')
    expect(d.entry.rev).toBeGreaterThan(e.rev)
    expect(d.photos).toEqual([])
    expect(existsSync(join(dataDir, row.originalPath))).toBe(true)
  })

  it('can discard an upload that was never attached', async () => {
    const id = await up('#999999')
    expect((await api(a, 'DELETE', `/api/photos/${id}`)).status).toBe(204)
    expect((await api(a, 'GET', `/api/photos/${id}/thumb`)).status).toBe(404)
  })
})

describe('photos the text never mentions', () => {
  it('are kept by text edits and deleted when the save names them', async () => {
    const [keep, loose] = [await up('#abcdef'), await up('#fedcba')]
    const e = await newEntry(`![](photo:${keep})\n\n![](photo:${loose})`)
    // Day One data can look like this: the photo belongs to the entry but the text lacks it.
    db.update(entries)
      .set({ bodyMd: `![](photo:${keep})` })
      .where(eq(entries.id, e.id))
      .run()

    let d = await detail(e.id)
    expect(d.photos.map((p) => p.id).sort()).toEqual([keep, loose].sort())
    const edit = await api(a, 'PATCH', `/api/entries/${e.id}`, {
      bodyMd: `![](photo:${keep}) edited`,
      baseRev: d.entry.rev,
    })
    d = (await edit.json()) as typeof d
    expect(d.photos.map((p) => p.id)).toContain(loose)

    // The text's own photos can't be removed this way; the unmentioned one can.
    const res = await api(a, 'PATCH', `/api/entries/${e.id}`, {
      starred: true,
      removePhotoIds: [keep, loose],
      baseRev: d.entry.rev,
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as typeof d).photos.map((p) => p.id)).toEqual([keep])
  })
})
