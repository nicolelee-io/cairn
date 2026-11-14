import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { attachmentMarkdown } from '@cairn/shared'
import { eq } from 'drizzle-orm'
import { createApp } from '../app.ts'
import { attachments } from '../db/schema.ts'
import { createRepos } from '../repo/index.ts'
import { parseRange } from '../routes/attachments.ts'
import { addUser, memoryDb } from '../test-helpers.ts'
import { cleanFilename, sniffAttachment } from './upload.ts'

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

const bmff = (brand: string, rest = 'payload') =>
  Buffer.concat([
    Buffer.from([0, 0, 0, 20]),
    Buffer.from(`ftyp${brand}`, 'latin1'),
    Buffer.from([0, 0, 2, 0]),
    Buffer.from(`isom${rest}`, 'latin1'),
  ])
const PDF = Buffer.from('%PDF-1.4\nhello pdf\n%%EOF\n')

const api = (cookie: string, method: string, path: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { host: HOST, cookie, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const put = (cookie: string, bytes: Buffer, name = 'f.pdf') =>
  app.request(`/api/attachments?name=${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { host: HOST, cookie, 'content-type': 'application/octet-stream' },
    body: new Uint8Array(bytes),
  })
const upload = async (bytes: Buffer, name?: string) => {
  const res = await put(a, bytes, name)
  expect(res.status).toBe(201)
  return (await res.json()) as { id: string; kind: string; filename: string; bytes: number }
}
const newEntry = async (bodyMd: string) => {
  const res = await api(a, 'POST', '/api/entries', { journalId: journal, timezone: 'UTC', bodyMd })
  expect(res.status).toBe(201)
  return ((await res.json()) as { entry: { id: string; rev: number } }).entry
}
const detail = async (id: string) =>
  (await (await api(a, 'GET', `/api/entries/${id}`)).json()) as {
    entry: { bodyMd: string; rev: number }
    attachments: { id: string; position: number }[]
  }

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'cairn-attach-'))
  db = memoryDb().db
  aId = (await addUser(db, 'a', 'pw', 'admin')).id
  await addUser(db, 'b')
  app = createApp({ sha: 'x', db, dataDir })
  a = await login('a')
  b = await login('b')
  journal = createRepos(db, aId).journals.create({ name: 'J' }).id
})
afterAll(() => rmSync(dataDir, { recursive: true, force: true }))

describe('sniffAttachment', () => {
  it('knows PDF, MP4, MOV and M4A by their bytes, and refuses images in the same container', () => {
    expect(sniffAttachment(PDF)?.kind).toBe('pdf')
    expect(sniffAttachment(bmff('isom'))).toMatchObject({ kind: 'video', ext: 'mp4' })
    expect(sniffAttachment(bmff('qt  '))).toMatchObject({ kind: 'video', ext: 'mov' })
    expect(sniffAttachment(bmff('M4A '))).toMatchObject({ kind: 'audio', ext: 'm4a' })
    expect(sniffAttachment(bmff('heic'))).toBeNull()
    expect(sniffAttachment(bmff('avif'))).toBeNull()
    expect(sniffAttachment(Buffer.from('<html>'))).toBeNull()
  })

  it('keeps a display-safe file name', () => {
    expect(cleanFilename('../../a\u0000b.pdf', 'pdf')).toBe('ab.pdf')
    expect(cleanFilename('C:\\docs\\x.pdf', 'pdf')).toBe('x.pdf')
    expect(cleanFilename('', 'mp4')).toBe('attachment.mp4')
  })
})

describe('parseRange', () => {
  it('reads the forms browsers send', () => {
    expect(parseRange(undefined, 10)).toBeNull()
    expect(parseRange('bytes=2-', 10)).toEqual([2, 9])
    expect(parseRange('bytes=-3', 10)).toEqual([7, 9])
    expect(parseRange('bytes=0-99', 10)).toEqual([0, 9])
    expect(parseRange('bytes=5-2', 10)).toBe('invalid')
    expect(parseRange('bytes=0-1,4-5', 10)).toBeNull() // multiple ranges: send it all
  })
})

describe('PUT /api/attachments', () => {
  it('stores the file once per content and serves it to the owner only', async () => {
    const first = await upload(PDF, 'Receipt é.pdf')
    expect(first).toMatchObject({ kind: 'pdf', filename: 'Receipt é.pdf', bytes: PDF.length })
    await upload(PDF, 'again.pdf') // same bytes: a second row, the same file
    const files = readdirSync(join(dataDir, 'attachments', aId))
    expect(files).toHaveLength(1) // no temp files left behind either

    const res = await api(a, 'GET', `/api/attachments/${first.id}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toBe(
      "inline; filename*=UTF-8''Receipt%20%C3%A9.pdf",
    )
    expect(Buffer.from(await res.arrayBuffer()).equals(PDF)).toBe(true)
    // Chrome's PDF viewer is blank under the app's object-src 'none'.
    expect(res.headers.get('content-security-policy')).toMatch(/object-src 'self'/)
    const dl = await api(a, 'GET', `/api/attachments/${first.id}?download`)
    expect(dl.headers.get('content-disposition')).toMatch(/^attachment;/)

    expect((await api(b, 'GET', `/api/attachments/${first.id}`)).status).toBe(404)
    expect((await api(b, 'DELETE', `/api/attachments/${first.id}`)).status).toBe(404)
  })

  it('serves byte ranges, as video players ask for', async () => {
    const video = bmff('isom', 'x'.repeat(100))
    const { id } = await upload(video, 'clip.mp4')
    const res = await app.request(`/api/attachments/${id}`, {
      headers: { host: HOST, cookie: a, range: 'bytes=4-11' },
    })
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe(`bytes 4-11/${video.length}`)
    expect(Buffer.from(await res.arrayBuffer()).toString('latin1')).toBe('ftypisom')
    const bad = await app.request(`/api/attachments/${id}`, {
      headers: { host: HOST, cookie: a, range: `bytes=${video.length}-` },
    })
    expect(bad.status).toBe(416)
  })

  it('refuses other file types, leaving nothing on disk', async () => {
    const before = readdirSync(join(dataDir, 'attachments', aId)).length
    const res = await put(a, Buffer.from('just text'), 'notes.txt')
    expect(res.status).toBe(415)
    expect(((await res.json()) as { message: string }).message).toMatch(/PDF, MP4, MOV or M4A/)
    expect((await put(a, bmff('heic'), 'photo.heic')).status).toBe(415)
    expect(readdirSync(join(dataDir, 'attachments', aId))).toHaveLength(before)
  })

  it('enforces the size limit from Settings, which never goes above 95 MB', async () => {
    expect(await (await api(a, 'GET', '/api/attachments/limit')).json()).toEqual({ maxMb: 95 })
    expect((await api(a, 'PUT', '/api/attachments/limit', { maxMb: 200 })).status).toBe(400)
    expect((await api(a, 'PUT', '/api/attachments/limit', { maxMb: 1 })).status).toBe(200)
    const big = Buffer.concat([PDF, Buffer.alloc(1024 * 1024)])
    const res = await put(a, big, 'big.pdf')
    expect(res.status).toBe(413)
    expect(((await res.json()) as { message: string }).message).toBe('That file is over 1 MB.')
    await api(a, 'PUT', '/api/attachments/limit', { maxMb: 95 })
  })

  it('requires a session', async () => {
    expect((await put('', PDF)).status).toBe(401)
  })
})

describe('attachments and entry text', () => {
  it('attach when referenced, follow the text order, and go when removed from it', async () => {
    const x = await upload(PDF, 'x.pdf')
    const y = await upload(bmff('M4A '), 'y.m4a')
    const e = await newEntry(
      `${attachmentMarkdown(y.id, 'y.m4a')}\n\n${attachmentMarkdown(x.id, 'x.pdf')}`,
    )
    expect((await detail(e.id)).attachments.map((f) => f.id)).toEqual([y.id, x.id])

    const res = await api(a, 'PATCH', `/api/entries/${e.id}`, {
      baseRev: e.rev,
      bodyMd: attachmentMarkdown(x.id, 'x.pdf'),
    })
    expect(res.status).toBe(200)
    expect((await detail(e.id)).attachments.map((f) => f.id)).toEqual([x.id])
    expect((await api(a, 'GET', `/api/attachments/${y.id}`)).status).toBe(404)
  })

  it('DELETE strips the reference from the text and keeps the file', async () => {
    const x = await upload(bmff('qt  ', 'mov'), 'x.mov')
    const e = await newEntry(`before\n\n${attachmentMarkdown(x.id, 'x.mov')}\n\nafter`)
    expect((await api(a, 'DELETE', `/api/attachments/${x.id}`)).status).toBe(204)
    const d = await detail(e.id)
    expect(d.entry.bodyMd).toBe('before\n\nafter')
    expect(d.attachments).toEqual([])
    expect(existsSync(join(dataDir, 'attachments', aId))).toBe(true)
  })

  it('removeMediaIds deletes one the text never mentions, and text edits leave it alone', async () => {
    const x = await upload(Buffer.from('%PDF-1.7 loose'), 'loose.pdf')
    const e = await newEntry('text only')
    // Attached without a reference, as an import whose placeholder didn't survive.
    db.update(attachments).set({ entryId: e.id }).where(eq(attachments.id, x.id)).run()
    let rev = e.rev
    const edit = await api(a, 'PATCH', `/api/entries/${e.id}`, { baseRev: rev, bodyMd: 'edited' })
    rev = ((await edit.json()) as { entry: { rev: number } }).entry.rev
    expect((await detail(e.id)).attachments.map((f) => f.id)).toEqual([x.id])

    const res = await api(a, 'PATCH', `/api/entries/${e.id}`, {
      baseRev: rev,
      removeMediaIds: [x.id],
    })
    expect(res.status).toBe(200)
    expect((await detail(e.id)).attachments).toEqual([])
  })
})
