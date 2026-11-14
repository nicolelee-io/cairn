import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../app.ts'
import { statusFile } from '../backup/status.ts'
import { photos } from '../db/schema.ts'
import { createRepos } from '../repo/index.ts'
import { addUser, memoryDb } from '../test-helpers.ts'
import { photoCompressor } from './compressExisting.ts'
import { compressImage } from './pipeline.ts'
import { photoQuality } from './quality.ts'
import { ingestUpload } from './upload.ts'

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'cairn-compress-'))
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

/** Camera-like: noisy, so a PNG is big and a JPEG at q85 clearly smaller. */
const noisy = (width: number, height: number, channels: 3 | 4 = 3) =>
  sharp({
    create: {
      width,
      height,
      channels,
      background: '#808080',
      noise: { type: 'gaussian', mean: 128, sigma: 40 },
    },
  })
const jpegWithExif = () =>
  noisy(5000, 3000)
    .jpeg({ quality: 100 })
    .withMetadata({ orientation: 6 }) // withExif can't set the orientation
    .withExifMerge({ IFD0: { Copyright: 'cairn test' } })
    .toBuffer()

const waitFor = async (done: () => boolean) => {
  for (let i = 0; i < 200 && !done(); i++) await new Promise((r) => setTimeout(r, 25))
}

describe('photo quality setting', () => {
  it('is compressed on a new server and original on one that has photos, decided once', async () => {
    const fresh = memoryDb().db
    expect(photoQuality(fresh).get()).toBe('compressed')

    const db = memoryDb().db
    const u = await addUser(db, 'a')
    createRepos(db, u.id).photos.add(
      await ingestUpload(dir, u.id, await noisy(40, 30).png().toBuffer(), 'original'),
    )
    expect(photoQuality(db).get()).toBe('original')
    db.delete(photos).run()
    expect(photoQuality(db).get()).toBe('original') // saved, not re-derived
  })
})

describe('compressImage', () => {
  it('makes a JPEG of at most 4096px that keeps the EXIF', async () => {
    const out = await compressImage(await jpegWithExif())
    expect(out).not.toBeNull()
    const meta = await sharp(out!).metadata()
    expect(meta.format).toBe('jpeg')
    expect(Math.max(meta.width!, meta.height!)).toBe(4096)
    expect(meta.orientation).toBe(6)
    expect(meta.exif?.toString('latin1')).toContain('cairn test')
  })

  it('takes opaque PNGs, even with an alpha channel', async () => {
    expect(await compressImage(await noisy(800, 600).png().toBuffer())).not.toBeNull()
    const opaqueAlpha = await noisy(800, 600).ensureAlpha(1).png().toBuffer()
    expect((await sharp(opaqueAlpha).metadata()).hasAlpha).toBe(true)
    expect(await compressImage(opaqueAlpha)).not.toBeNull()
  })

  it('leaves transparency, WebP, and anything it cannot make clearly smaller', async () => {
    const seeThrough = await noisy(800, 600, 4).png().toBuffer()
    expect(await compressImage(seeThrough)).toBeNull()
    expect(await compressImage(await noisy(800, 600).webp().toBuffer())).toBeNull()
    expect(await compressImage(await noisy(800, 600).jpeg({ quality: 60 }).toBuffer())).toBeNull()
  })
})

describe('uploads under the compressed setting', () => {
  it('store the compressed JPEG under the upload sha256, once, and serve it as such', async () => {
    const db = memoryDb().db
    const u = await addUser(db, 'a')
    const bytes = await noisy(1200, 900).png().toBuffer()
    const first = await ingestUpload(dir, u.id, bytes, 'compressed')
    expect(first.originalPath).toBe(`photos/${u.id}/compressed/${first.sha256}.jpg`)
    expect(first.mime).toBe('image/jpeg')
    expect(first.bytes).toBe(readFileSync(join(dir, first.originalPath)).length)
    expect(first.bytes).toBeLessThan(bytes.length)
    expect(existsSync(join(dir, `photos/${u.id}/originals/${first.sha256}.png`))).toBe(false)
    const again = await ingestUpload(dir, u.id, bytes, 'compressed')
    expect(again.originalPath).toBe(first.originalPath)

    // A WebP upload has nothing to gain: kept as it came.
    const webp = await ingestUpload(
      dir,
      u.id,
      await noisy(300, 200).webp().toBuffer(),
      'compressed',
    )
    expect(webp.originalPath).toMatch(/\/originals\/[0-9a-f]{64}\.webp$/)
  })
})

describe('compressing existing photos', () => {
  it('replaces each JPEG/PNG original once, repoints every row, and deletes the old file', async () => {
    const db = memoryDb().db
    const u = await addUser(db, 'a')
    const repos = createRepos(db, u.id)
    const png = await noisy(1200, 900).png().toBuffer()
    const shared = await ingestUpload(dir, u.id, png, 'original')
    const p1 = repos.photos.add(shared)
    const p2 = repos.photos.add({ ...shared, id: `${shared.id}-2` })
    repos.photos.remove(p2.id) // a tombstone on the same file follows along
    const webp = repos.photos.add(
      await ingestUpload(dir, u.id, await noisy(300, 200).webp().toBuffer(), 'original'),
    )
    const before = await photoCompressor(db, dir).candidates()
    expect(before.files).toBe(1)

    const job = photoCompressor(db, dir)
    expect(job.start()).toBe(true)
    expect(job.start()).toBe(false) // one at a time
    await waitFor(() => job.status().state !== 'running')
    expect(job.status()).toMatchObject({
      state: 'done',
      total: 1,
      done: 1,
      compressed: 1,
      kept: 0,
      failed: 0,
    })
    expect(job.status().savedBytes).toBeGreaterThan(0)

    const rows = db.select().from(photos).all()
    const target = `photos/${u.id}/compressed/${shared.sha256}.jpg`
    for (const id of [p1.id, p2.id])
      expect(rows.find((r) => r.id === id)).toMatchObject({
        originalPath: target,
        mime: 'image/jpeg',
        sha256: shared.sha256,
      })
    expect(existsSync(join(dir, shared.originalPath))).toBe(false)
    expect(existsSync(join(dir, target))).toBe(true)
    expect(rows.find((r) => r.id === webp.id)?.originalPath).toBe(webp.originalPath)
    expect((await job.candidates()).files).toBe(0)
  })
})

describe('admin photo routes', () => {
  const HOST = 'cairn.test'
  it('are admin only, and compressing needs the compressed setting and a fresh backup', async () => {
    const data = mkdtempSync(join(tmpdir(), 'cairn-compress-app-'))
    const db = memoryDb().db
    await addUser(db, 'admin', 'pw', 'admin')
    await addUser(db, 'plain')
    const app = createApp({ sha: 'x', db, dataDir: data })
    const login = async (username: string) =>
      (
        await app.request('/api/auth/login', {
          method: 'POST',
          headers: { host: HOST, 'content-type': 'application/json' },
          body: JSON.stringify({ username, password: 'pw' }),
        })
      ).headers
        .get('set-cookie')!
        .split(';')[0]!
    const as = (cookie: string) => (method: string, path: string, body?: unknown) =>
      app.request(path, {
        method,
        headers: { host: HOST, cookie, 'content-type': 'application/json' },
        body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body),
      })
    const admin = as(await login('admin'))
    const plain = as(await login('plain'))

    for (const [m, p] of [
      ['GET', '/api/admin/photos'],
      ['PUT', '/api/admin/photos'],
      ['POST', '/api/admin/photos/compress'],
    ] as const)
      expect((await plain(m, p, { quality: 'original' })).status).toBe(403)

    expect(await (await admin('GET', '/api/admin/photos')).json()).toMatchObject({
      quality: 'compressed',
      candidates: { files: 0, bytes: 0 },
      lastBackupAt: null,
      job: { state: 'idle' },
    })
    expect((await admin('POST', '/api/admin/photos/compress')).status).toBe(409) // no backup
    const backedUp = (at: number) => {
      mkdirSync(join(data, 'backups'), { recursive: true })
      writeFileSync(
        statusFile(data),
        JSON.stringify({
          lastRun: { at, ok: true, error: null },
          lastSuccess: { at, snapshotId: 's' },
        }),
      )
    }
    backedUp(Date.now() - 25 * 60 * 60 * 1000)
    expect(await (await admin('POST', '/api/admin/photos/compress')).json()).toEqual({
      error: 'backup_needed',
    })
    backedUp(Date.now())

    expect((await admin('PUT', '/api/admin/photos', { quality: 'nope' })).status).toBe(400)
    const off = await admin('PUT', '/api/admin/photos', { quality: 'original' })
    expect(((await off.json()) as { quality: string }).quality).toBe('original')
    expect(await (await admin('POST', '/api/admin/photos/compress')).json()).toEqual({
      error: 'quality_original',
    })

    await admin('PUT', '/api/admin/photos', { quality: 'compressed' })
    expect((await admin('POST', '/api/admin/photos/compress')).status).toBe(202)
    rmSync(data, { recursive: true, force: true })
  })
})
