import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import yazl from 'yazl'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ImportPreviewSchema, ImportStatusSchema, type ImportPreview } from '@cairn/shared'
import { createApp } from '../app.ts'
import { attachmentLimit } from '../attachments/limit.ts'
import { photoQuality } from '../photos/quality.ts'
import { createRepos } from '../repo/index.ts'
import { addUser, listEntries, memoryDb } from '../test-helpers.ts'
import { importJobs, STAGED_FOR_MS, type ImportJobs } from './jobs.ts'

const SAMPLE = readFileSync(
  resolve(import.meta.dirname, '../../../../fixtures/sample-dayone-export.zip'),
)
const HOST = 'cairn.test'

type Client = (
  method: string,
  path: string,
  body?: unknown,
  raw?: Buffer,
) => Response | Promise<Response>

let dataDir: string
let h: ReturnType<typeof memoryDb>
let imports: ImportJobs
let clock: number
let app: ReturnType<typeof createApp>
let ids: Record<'a' | 'b' | 'boss', string>

async function signIn(username: string): Promise<Client> {
  const res = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { host: HOST, 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'pw' }),
  })
  expect(res.status).toBe(200)
  const cookie = res.headers.get('set-cookie')!.split(';')[0]!
  return (method, path, body, raw) =>
    app.request(path, {
      method,
      headers: {
        host: HOST,
        cookie,
        ...(raw ? { 'content-type': 'application/zip' } : { 'content-type': 'application/json' }),
      },
      body: raw ? new Uint8Array(raw) : body === undefined ? undefined : JSON.stringify(body),
    })
}

/** A zip of the given files, in memory. */
function zipOf(files: Record<string, string>): Promise<Buffer> {
  const z = new yazl.ZipFile()
  for (const [name, text] of Object.entries(files)) z.addBuffer(Buffer.from(text), name)
  z.end()
  return new Promise((done, fail) => {
    const chunks: Buffer[] = []
    z.outputStream.on('data', (c: Buffer) => chunks.push(c))
    z.outputStream.on('end', () => done(Buffer.concat(chunks)))
    z.outputStream.on('error', fail)
  })
}

const upload = async (c: Client, zip: Buffer, name = 'export.zip') =>
  c('PUT', `/api/import?name=${encodeURIComponent(name)}`, undefined, zip)
const preview = async (res: Response): Promise<ImportPreview> => {
  expect(res.status).toBe(201)
  return ImportPreviewSchema.parse(await res.json())
}
const status = async (c: Client) =>
  ImportStatusSchema.parse(await (await c('GET', '/api/import')).json())
const uploadsLeft = () =>
  existsSync(join(dataDir, 'imports')) ? readdirSync(join(dataDir, 'imports')) : []

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'cairn-import-jobs-'))
  h = memoryDb()
  photoQuality(h.db).set('original')
  clock = 1_700_000_000_000
  imports = importJobs(h.db, dataDir, () => clock)
  app = createApp({ sha: 'x', db: h.db, dataDir, imports })
  ids = {
    a: (await addUser(h.db, 'a')).id,
    b: (await addUser(h.db, 'b')).id,
    boss: (await addUser(h.db, 'boss', 'pw', 'admin')).id,
  }
})
afterEach(async () => {
  await imports.settled()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('import from Settings', () => {
  it('needs a session', async () => {
    const res = await app.request('/api/import', { headers: { host: HOST } })
    expect(res.status).toBe(401)
  })

  it('previews an upload without writing, then imports it into the uploader only', async () => {
    const a = await signIn('a')
    const p = await preview(await upload(a, SAMPLE, 'my export.zip'))
    expect(p.filename).toBe('my export.zip')
    expect(p.bytes).toBe(SAMPLE.length)
    expect(p.expiresAt).toBe(clock + STAGED_FOR_MS)
    expect(p.journals.map((j) => [j.name, j.entries, j.alreadyImported, j.exists]).sort()).toEqual([
      ['Sample Journal', expect.any(Number), 0, false],
      ['Travel', expect.any(Number), 0, false],
    ])
    expect(p.journals.reduce((n, j) => n + j.entries, 0)).toBe(15)
    expect(p.photos).toBe(7)
    expect(p.attachments).toBe(4)
    expect(listEntries(h.db, ids.a)).toHaveLength(0)
    expect((await status(a)).staged?.id).toBe(p.id)

    const started = await a('POST', `/api/import/${p.id}/start`, { archived: ['Travel'] })
    expect(started.status).toBe(202)
    await imports.settled()

    const s = await status(a)
    expect(s.staged).toBeNull()
    expect(s.job).toMatchObject({ state: 'done', total: 15, done: 15, filename: 'my export.zip' })
    expect(s.job!.report!.journals.reduce((n, j) => n + j.imported, 0)).toBe(15)
    expect(s.job!.report!.photosImported).toBe(7)
    expect(s.job!.report!.failureCount).toBe(0)
    expect(listEntries(h.db, ids.a, { limit: 100 })).toHaveLength(15)
    const travel = createRepos(h.db, ids.a).journals.findByName('Travel')!
    expect(travel.archivedAt).not.toBeNull()
    // Nobody else's account got anything, the admin's included, and the upload is gone.
    expect(listEntries(h.db, ids.b)).toHaveLength(0)
    expect(listEntries(h.db, ids.boss)).toHaveLength(0)
    expect(uploadsLeft()).toEqual([])
  })

  it('a second upload of the same export shows it as imported and adds nothing', async () => {
    const a = await signIn('a')
    const first = await preview(await upload(a, SAMPLE))
    await a('POST', `/api/import/${first.id}/start`, {})
    await imports.settled()

    const again = await preview(await upload(a, SAMPLE))
    expect(again.journals.every((j) => j.exists && j.alreadyImported === j.entries)).toBe(true)
    await a('POST', `/api/import/${again.id}/start`, {})
    await imports.settled()
    const r = (await status(a)).job!.report!
    expect(r.journals.reduce((n, j) => n + j.skipped, 0)).toBe(15)
    expect(r.journals.reduce((n, j) => n + j.imported, 0)).toBe(0)
    expect(listEntries(h.db, ids.a, { limit: 100 })).toHaveLength(15)
  })

  it('reads a Cairn export (Day One’s format with extras) back as already imported', async () => {
    const a = await signIn('a')
    const p = await preview(await upload(a, SAMPLE))
    await a('POST', `/api/import/${p.id}/start`, {})
    await imports.settled()
    const zip = Buffer.from(await (await a('GET', '/api/export?media=0')).arrayBuffer())
    const back = await preview(await upload(a, zip))
    expect(back.journals.reduce((n, j) => n + j.alreadyImported, 0)).toBe(15)
    // Into another account it is all new.
    const b = await signIn('b')
    const theirs = await preview(await upload(b, zip))
    expect(theirs.journals.every((j) => j.alreadyImported === 0 && !j.exists)).toBe(true)
  })

  it('refuses a file that is not a zip, or a zip with no journals, and keeps nothing', async () => {
    const a = await signIn('a')
    const notZip = await upload(a, Buffer.from('hello, not a zip'))
    expect(notZip.status).toBe(415)
    expect(await notZip.json()).toMatchObject({ error: 'unsupported_format' })

    const noJournals = await upload(a, await zipOf({ 'readme.txt': 'hi', 'photos/x.jpg': 'x' }))
    expect(noJournals.status).toBe(415)
    const notEntries = await upload(a, await zipOf({ 'Journal.json': '{"hello": 1}' }))
    expect(notEntries.status).toBe(415)
    const badJson = await upload(a, await zipOf({ 'Journal.json': '{not json' }))
    expect(badJson.status).toBe(415)

    expect(uploadsLeft()).toEqual([])
    expect((await status(a)).staged).toBeNull()
  })

  it('refuses an upload over the attachment limit', async () => {
    attachmentLimit(h.db).set(1)
    const a = await signIn('a')
    const big = Buffer.alloc(1024 * 1024 + 1)
    const res = await upload(a, big)
    expect(res.status).toBe(413)
    expect(await res.json()).toMatchObject({ error: 'too_large' })
    expect(uploadsLeft()).toEqual([])
  })

  it('refuses a small zip whose media would unpack far past the upload limit', async () => {
    attachmentLimit(h.db).set(1)
    const a = await signIn('a')
    const bomb = await zipOf({
      'Journal.json': JSON.stringify({ entries: [] }),
      'videos/big.mp4': 'a'.repeat(2 * 1024 * 1024 + 1),
    })
    expect(bomb.length).toBeLessThan(100 * 1024)
    const res = await upload(a, bomb)
    expect(res.status).toBe(413)
    expect(await res.json()).toMatchObject({ error: 'too_large' })
    expect(uploadsLeft()).toEqual([])
    // Twice the limit is still fine: real media hardly compresses, the JSON beside it does.
    const ok = await zipOf({
      'Journal.json': JSON.stringify({ entries: [] }),
      'videos/big.mp4': 'a'.repeat(2 * 1024 * 1024),
    })
    await preview(await upload(a, ok))
  })

  it("nobody can see, start or cancel another user's upload, an admin included", async () => {
    const a = await signIn('a')
    const boss = await signIn('boss')
    const p = await preview(await upload(a, SAMPLE))
    expect((await status(boss)).staged).toBeNull()
    expect((await boss('POST', `/api/import/${p.id}/start`, {})).status).toBe(404)
    expect((await boss('DELETE', `/api/import/${p.id}`)).status).toBe(404)
    expect((await status(a)).staged?.id).toBe(p.id)
    expect((await a('DELETE', `/api/import/${p.id}`)).status).toBe(204)
    expect((await status(a)).staged).toBeNull()
    expect(uploadsLeft()).toEqual([])
  })

  it('a new upload replaces the last, and one left unstarted expires', async () => {
    const a = await signIn('a')
    const first = await preview(await upload(a, SAMPLE))
    const second = await preview(await upload(a, SAMPLE))
    expect((await a('POST', `/api/import/${first.id}/start`, {})).status).toBe(404)
    expect(uploadsLeft()).toEqual([`${second.id}.zip`])
    clock += STAGED_FOR_MS
    expect((await status(a)).staged).toBeNull()
    expect(uploadsLeft()).toEqual([])
    expect((await a('POST', `/api/import/${second.id}/start`, {})).status).toBe(404)
  })

  it('runs one import at a time on the server', async () => {
    const a = await signIn('a')
    const b = await signIn('b')
    const pa = await preview(await upload(a, SAMPLE))
    const pb = await preview(await upload(b, SAMPLE))
    expect((await a('POST', `/api/import/${pa.id}/start`, {})).status).toBe(202)
    expect((await status(b)).busy).toBe(true)
    expect((await status(a)).busy).toBe(false)
    const refused = await b('POST', `/api/import/${pb.id}/start`, {})
    expect(refused.status).toBe(409)
    expect(await refused.json()).toMatchObject({ error: 'import_busy' })
    // While A's runs, A can't upload another; B's upload waits and starts afterwards.
    expect((await upload(a, SAMPLE)).status).toBe(409)
    await imports.settled()
    expect((await b('POST', `/api/import/${pb.id}/start`, {})).status).toBe(202)
    await imports.settled()
    expect(listEntries(h.db, ids.b, { limit: 100 })).toHaveLength(15)
  })
})
