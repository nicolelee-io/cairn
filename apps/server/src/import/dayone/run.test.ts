import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { photoQuality } from '../../photos/quality.ts'
import { createRepos } from '../../repo/index.ts'
import { addUser, listEntries, memoryDb } from '../../test-helpers.ts'
import { importDayOne, type ImportReport } from './run.ts'
import { openDirSource, openZipSource } from './source.ts'

const SAMPLE_ZIP = resolve(import.meta.dirname, '../../../../../fixtures/sample-dayone-export.zip')

let dataDir: string
let h: ReturnType<typeof memoryDb>
let userId: string
beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'cairn-import-'))
  h = memoryDb()
  photoQuality(h.db).set('original') // compression has its own test below
  userId = (await addUser(h.db, 'alice')).id
})
afterEach(() => rmSync(dataDir, { recursive: true, force: true }))

async function importZip(
  archived?: string[],
  uid = userId,
  reimportPurged = false,
): Promise<ImportReport> {
  const source = await openZipSource(SAMPLE_ZIP)
  try {
    return await importDayOne({
      source,
      db: h.db,
      dataDir,
      userId: uid,
      defaultTimezone: 'America/Denver',
      archived,
      reimportPurged,
      now: 1_700_000_000_000,
    })
  } finally {
    await source.close()
  }
}

const sum = (r: ImportReport, k: 'imported' | 'skipped' | 'failed') =>
  r.journals.reduce((n, j) => n + j[k], 0)

describe('sample export (zip)', () => {
  it('imports every entry and photo, with files on disk', async () => {
    const r = await importZip()
    expect(r.failures).toEqual([])
    expect(r.journals.map((j) => j.name).sort()).toEqual(['Sample Journal', 'Travel'])
    expect(sum(r, 'imported')).toBe(15)
    expect(r.photosImported).toBe(7)
    expect(r.photosMissing).toBe(0)
    expect(r.unmappedKeys).toEqual({})

    expect(listEntries(h.db, userId, { limit: 100 })).toHaveLength(15)
    const files = readdirSync(join(dataDir, 'photos', userId, 'originals'))
    expect(files.length).toBe(7)
    expect(files.every((f) => f.endsWith('.jpg'))).toBe(true)
    for (const kind of ['display', 'thumb']) {
      const made = readdirSync(join(dataDir, 'photos', userId, kind))
      expect(made.length).toBe(7)
      expect(made.every((f) => f.endsWith('.webp'))).toBe(true)
    }
  })

  it('imports videos, audio and PDFs, referenced or not', async () => {
    const r = await importZip()
    expect(r.attachmentsImported).toBe(4)
    expect(r.attachmentsMissing).toBe(0)
    expect(r.warnings).toEqual([])
    const repos = createRepos(h.db, userId)
    const id = listEntries(h.db, userId, { limit: 100 }).find((e) =>
      e.bodyMd.startsWith('# Attachments'),
    )!.id
    const d = repos.entries.detail(id)!
    // Day One's order (as for photos: list by list, then orderInEntry), not the text's.
    expect(d.attachments.map((a) => [a.kind, a.filename, a.mime])).toEqual([
      ['video', 'video.mp4', 'video/mp4'],
      ['audio', 'audio.m4a', 'audio/mp4'],
      ['pdf', 'Sample receipt.pdf', 'application/pdf'],
      ['pdf', 'Loose manual.pdf', 'application/pdf'],
    ])
    const [video, audio, pdf] = d.attachments
    expect(d.entry.bodyMd).toBe(
      `# Attachments\n\n![Sample receipt.pdf](attachment:${pdf!.id})\n\n` +
        `![video.mp4](attachment:${video!.id})\n\nA voice memo ![audio.m4a](attachment:${audio!.id}) from the beach.\n`,
    )
    expect(readdirSync(join(dataDir, 'attachments', userId)).sort()).toEqual(
      d.attachments.map((a) => a.path.split('/').pop()).sort(),
    )
  })

  it('is idempotent: a second run skips everything and adds nothing', async () => {
    await importZip()
    const repos = createRepos(h.db, userId)
    const before = listEntries(h.db, userId, { limit: 100 }).map((e) => [e.id, e.rev])
    const r = await importZip()
    expect(sum(r, 'imported')).toBe(0)
    expect(sum(r, 'skipped')).toBe(15)
    expect(r.photosImported).toBe(0)
    expect(listEntries(h.db, userId, { limit: 100 }).map((e) => [e.id, e.rev])).toEqual(before)
    expect(repos.journals.list({ includeArchived: true })).toHaveLength(2)
  })

  it('skips entries emptied from the trash, unless --force (reimportPurged) asks for them', async () => {
    await importZip()
    const repos = createRepos(h.db, userId)
    const [gone, trashed] = listEntries(h.db, userId, { limit: 2 })
    repos.entries.softDelete(gone!.id)
    repos.trash.purgeEntry(gone!.id)
    repos.entries.softDelete(trashed!.id) // still in the trash: not purged

    const plain = await importZip()
    expect(sum(plain, 'imported')).toBe(0) // a deliberate delete doesn't come back by itself

    const forced = await importZip(undefined, userId, true)
    expect(sum(forced, 'imported')).toBe(1) // only the purged one; the trashed one stays put
    expect(sum(forced, 'skipped')).toBe(14)
    const back = listEntries(h.db, userId, { limit: 100 }).find(
      (e) => e.sourceId === gone!.sourceId,
    )!
    expect(back.id).not.toBe(gone!.id) // a fresh copy under a new id
    expect(repos.entries.detail(back.id)!.entry.bodyMd).not.toBe('')
    // The scrubbed tombstone stays for sync, without its source id.
    const tomb = h.sqlite
      .prepare('SELECT source_id, purged_at FROM entry WHERE id = ?')
      .get(gone!.id) as { source_id: string | null; purged_at: number | null }
    expect(tomb).toEqual({ source_id: null, purged_at: expect.any(Number) })

    expect(sum(await importZip(undefined, userId, true), 'imported')).toBe(0) // idempotent again
  })

  it('leaves later edits alone on re-import', async () => {
    await importZip()
    const repos = createRepos(h.db, userId)
    const e = listEntries(h.db, userId, { limit: 1 })[0]!
    repos.entries.update(e.id, { bodyMd: 'edited in cairn' })
    await importZip()
    expect(repos.entries.get(e.id)?.bodyMd).toBe('edited in cairn')
  })

  it('imports a journal as archived on request', async () => {
    const r = await importZip(['Travel'])
    expect(r.journals.find((j) => j.name === 'Travel')?.archived).toBe(true)
    const repos = createRepos(h.db, userId)
    expect(repos.journals.list().map((j) => j.name)).toEqual(['Sample Journal'])
    expect(await importZip(['Nope']).then((x) => x.warnings.join())).toContain('"Nope"')
  })

  it('keeps a multi-photo entry in order with rewritten placeholders and raw JSON', async () => {
    await importZip()
    const repos = createRepos(h.db, userId)
    const multi = listEntries(h.db, userId, { limit: 100 })
      .map((e) => repos.entries.detail(e.id)!)
      .filter((d) => d.photos.length > 1)
    expect(multi.length).toBeGreaterThan(0)
    // Photos not mentioned in the text are still attached to their entry.
    const unreferenced = multi.flatMap((d) =>
      d.photos.filter((p) => !d.entry.bodyMd.includes(p.id)),
    )
    expect(unreferenced.length).toBeGreaterThan(0)
    for (const d of multi) {
      expect(d.photos.map((p) => p.position)).toEqual(d.photos.map((_, i) => i))
      for (const p of d.photos) {
        for (const path of [p.originalPath, p.displayPath, p.thumbPath]) {
          expect(path && existsSync(join(dataDir, path))).toBe(true)
        }
        expect(p.displayPath).toBe(`photos/${userId}/display/${p.sha256}.webp`)
        expect(p.width).toBeGreaterThan(0)
        expect(p.height).toBeGreaterThan(0)
        expect(p.originalPath.startsWith(`photos/${userId}/`)).toBe(true)
        expect(p.mime).toBe('image/jpeg')
      }
      expect(d.entry.bodyMd).not.toContain('dayone-moment')
      const ids = new Set(d.photos.map((p) => p.id))
      const refs = [...d.entry.bodyMd.matchAll(/\]\(photo:([^)]+)\)/g)].map((m) => m[1]!)
      expect(refs.length).toBeGreaterThan(0)
      for (const r of refs) expect(ids.has(r)).toBe(true)
      expect(d.entry.source).toBe('dayone')
      expect(JSON.parse(d.entry.sourceRaw!).uuid).toBe(d.entry.sourceId)
    }
  })

  it('reads photo GPS from EXIF into the database', async () => {
    await importZip()
    const repos = createRepos(h.db, userId)
    const all = listEntries(h.db, userId, { limit: 100 }).flatMap(
      (e) => repos.entries.detail(e.id)!.photos,
    )
    const geo = all.filter((p) => p.latitude !== null)
    expect(geo.length).toBeGreaterThan(0)
    expect(geo.every((p) => Math.abs(p.latitude!) <= 90 && Math.abs(p.longitude!) <= 180)).toBe(
      true,
    )
  })

  it('maps location, weather, tags and timezones', async () => {
    await importZip()
    const repos = createRepos(h.db, userId)
    const all = listEntries(h.db, userId, { limit: 100 }).map((e) => repos.entries.detail(e.id)!)
    const withWeather = all.filter((d) => d.weather)
    expect(withWeather.length).toBeGreaterThan(0)
    for (const d of withWeather) {
      expect(d.weather!.source).toBe('dayone')
      expect(d.weather!.condition).not.toBe('unknown')
    }
    const night = withWeather.find((d) => d.weather!.sourceCode === 'clear-night')!
    expect(night.weather).toMatchObject({ condition: 'clear', isDay: false })
    expect(all.some((d) => d.location?.placeName)).toBe(true)
    expect(all.some((d) => d.tags.length > 0)).toBe(true)
    // Entry mood is never guessed.
    expect(all.every((d) => d.entry.moodKey === null && d.entry.moodSuggested === null)).toBe(true)
    expect(new Set(all.map((d) => d.entry.timezone)).size).toBeGreaterThan(0)
  })

  it('lets a second user import the same export independently', async () => {
    await importZip()
    const other = (await addUser(h.db, 'other')).id
    const r = await importZip(undefined, other)
    expect(sum(r, 'imported')).toBe(15)
    expect(listEntries(h.db, other, { limit: 100 })).toHaveLength(15)
    expect(listEntries(h.db, userId, { limit: 100 })).toHaveLength(15)
  })
})

describe('quirks seen in a real export (folder source)', () => {
  const T = '2024-03-10T15:00:00Z'
  function build(entries: unknown[], files: Record<string, string> = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-export-'))
    writeFileSync(
      join(dir, '📖 Journal.json'),
      JSON.stringify({ metadata: { version: '1.0' }, entries }),
    )
    for (const [path, body] of Object.entries(files)) {
      mkdirSync(join(dir, path, '..'), { recursive: true })
      writeFileSync(join(dir, path), body)
    }
    return dir
  }
  const photo = (id: string, md5: string, order: number) => ({
    identifier: id,
    md5,
    type: 'jpg',
    width: 0,
    height: 0,
    orderInEntry: order,
    date: T,
  })

  async function run(
    dir: string,
    limits: { maxPhotoBytes?: number; maxAttachmentBytes?: number } = {},
  ) {
    const source = openDirSource(dir)
    try {
      return await importDayOne({
        ...limits,
        source,
        db: h.db,
        dataDir,
        userId,
        defaultTimezone: 'America/Denver',
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it('handles placeholders, attachments, ordering, missing files, bad timezone and odd keys', async () => {
    const dir = build(
      [
        {
          uuid: 'A1',
          creationDate: T,
          modifiedDate: '2024-03-11T15:00:00Z',
          timeZone: 'America/New_York',
          // Text order (P2, P1) differs from orderInEntry (P1, P2); also a duplicate ref, a broken
          // placeholder, a video, and a photo whose file is absent.
          text: 'a ![](dayone-moment://P2) b ![](dayone-moment://P1) c ![](dayone-moment://P1)\n![](dayone-moment://undefined)\n![](dayone-moment:/video/V1)\n![](dayone-moment://P3)\n\\- kept \\. escapes',
          photos: [photo('P1', 'aaaa', 0), photo('P2', 'bbbb', 1), photo('P3', 'cccc', 2)],
          videos: [{ identifier: 'V1', md5: 'dddd', type: 'mp4', orderInEntry: 3 }],
          weather: { weatherCode: 'clear', temperatureCelsius: 3 },
          futureKey: 1,
        },
        { uuid: 'A2', creationDate: T, timeZone: 'Not/AZone', text: '', tags: ['x', 'x', ' y '] },
        { uuid: 'A3', creationDate: 'garbage' },
        { creationDate: T },
      ],
      { 'photos/aaaa.jpg': 'ONE', 'photos/bbbb.jpg': 'TWO', 'videos/dddd.mp4': 'VID' },
    )
    const r = await run(dir)

    expect(r.journals[0]).toMatchObject({ name: '📖 Journal', imported: 2, failed: 2 })
    expect(r.failures.map((f) => f.uuid)).toContain('A3')
    expect(r.photosImported).toBe(2)
    expect(r.photosMissing).toBe(1)
    expect(r.attachmentsImported).toBe(1)
    expect(r.warnings.join('\n')).toContain('videos/dddd.mp4 is not a PDF, MP4, MOV or M4A')
    expect(r.brokenPlaceholders).toBe(2) // "undefined" and the photo with no file
    expect(r.unmappedKeys).toEqual({ futureKey: 1 })

    const repos = createRepos(h.db, userId)
    const a1 = repos.entries.detail(listEntries(h.db, userId).find((e) => e.sourceId === 'A1')!.id)!
    expect(a1.photos.map((p) => p.sourceRef)).toEqual(['P1', 'P2'])
    const [p1, p2] = a1.photos
    const [v1] = a1.attachments
    expect(v1).toMatchObject({ kind: 'video', filename: 'video.mp4', sourceRef: 'V1', bytes: 3 })
    expect(a1.entry.bodyMd).toBe(
      `a ![](photo:${p2!.id}) b ![](photo:${p1!.id}) c ![](photo:${p1!.id})\n\n![video.mp4](attachment:${v1!.id})\n\n\\- kept \\. escapes`,
    )
    // The fake bytes aren't an image: the original is kept, derivatives are skipped with a warning.
    expect(a1.photos[0]).toMatchObject({
      width: null,
      height: null,
      bytes: 3,
      displayPath: null,
      thumbPath: null,
    })
    expect(r.warnings.join('\n')).toContain('no derivatives for P1')
    expect(a1.entry.timezone).toBe('America/New_York')
    expect(a1.entry.createdAt).toBe(Date.parse(T))
    expect(a1.entry.modifiedAt).toBe(Date.parse('2024-03-11T15:00:00Z'))
    expect(a1.weather).toMatchObject({ condition: 'clear', isDay: null })

    const a2 = repos.entries.detail(listEntries(h.db, userId).find((e) => e.sourceId === 'A2')!.id)!
    expect(a2.entry.timezone).toBe('America/Denver')
    expect(a2.entry.bodyMd).toBe('')
    expect(a2.tags).toEqual(['x', 'y'])
    expect(r.warnings.join('\n')).toContain('Not/AZone')
  })

  it('keeps a markdown table intact, including a photo inside a cell', async () => {
    const table =
      '| Item | Qty \\| unit | Note |\n| :--- | ---: | :---: |\n| Tea | 2 | ![](dayone-moment://P1) |\n| Milk | 1 | \\- fresh |'
    const dir = build(
      [
        {
          uuid: 'T1',
          creationDate: T,
          text: `# Shopping\n\n${table}\n\nafter`,
          photos: [photo('P1', 'aaaa', 0)],
        },
      ],
      {
        'photos/aaaa.jpg': 'ONE',
      },
    )
    await run(dir)
    const e = listEntries(h.db, userId).find((x) => x.sourceId === 'T1')!
    const detail = createRepos(h.db, userId).entries.detail(e.id)!
    const photoId = detail.photos[0]!.id
    expect(detail.entry.bodyMd).toBe(
      `# Shopping\n\n${table.replace('dayone-moment://P1', `photo:${photoId}`)}\n\nafter`,
    )
  })

  it('records an unrecognised weather code as unknown and keeps the code', async () => {
    const dir = build([
      { uuid: 'W1', creationDate: T, timeZone: 'UTC', weather: { weatherCode: 'Volcanic' } },
    ])
    const r = await run(dir)
    const repos = createRepos(h.db, userId)
    const d = repos.entries.detail(listEntries(h.db, userId)[0]!.id)!
    expect(d.weather).toMatchObject({ condition: 'unknown', sourceCode: 'Volcanic' })
    expect(r.warnings.join()).toContain('Volcanic')
  })

  it('fails an entry whose photo or file is over the given limit, before reading it', async () => {
    const dir = build(
      [
        { uuid: 'BIGP', creationDate: T, text: 'p', photos: [photo('P1', 'aaaa', 0)] },
        {
          uuid: 'BIGV',
          creationDate: T,
          text: 'v',
          videos: [{ identifier: 'V1', md5: 'dddd', type: 'mp4', orderInEntry: 0 }],
        },
        { uuid: 'OK', creationDate: T, text: 'fine', photos: [photo('P2', 'bbbb', 0)] },
      ],
      {
        'photos/aaaa.jpg': 'x'.repeat(11),
        'photos/bbbb.jpg': 'x'.repeat(10),
        'videos/dddd.mp4': 'x'.repeat(21),
      },
    )
    const r = await run(dir, { maxPhotoBytes: 10, maxAttachmentBytes: 20 })

    expect(r.journals[0]).toMatchObject({ imported: 1, failed: 2 })
    expect(r.failures.map((f) => [f.uuid, f.error])).toEqual([
      ['BIGP', expect.stringContaining('photos/aaaa.jpg is over')],
      ['BIGV', expect.stringContaining('videos/dddd.mp4 is over')],
    ])
    expect(listEntries(h.db, userId).map((e) => e.sourceId)).toEqual(['OK'])
    // Nothing of the oversized files reached the data dir.
    expect(existsSync(join(dataDir, 'attachments'))).toBe(false)
    expect(readdirSync(join(dataDir, 'photos', userId, 'originals'))).toHaveLength(1)
  })

  it('rejects a path-traversing photo name', async () => {
    const dir = build([
      { uuid: 'T1', creationDate: T, photos: [{ ...photo('P', '../../etc/passwd', 0) }] },
    ])
    const r = await run(dir)
    expect(r.failures[0]?.error).toContain('unsafe')
  })
})
