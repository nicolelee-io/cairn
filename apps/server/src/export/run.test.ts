import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import yauzl from 'yauzl'
import { mapDayOneWeather, toDayOneWeatherCode, WEATHER_CONDITIONS } from '@cairn/shared'
import { importDayOne } from '../import/dayone/run.ts'
import { openZipSource, type ExportSource } from '../import/dayone/source.ts'
import { photoQuality } from '../photos/quality.ts'
import { ingestUpload } from '../photos/upload.ts'
import { createRepos } from '../repo/index.ts'
import { addUser, listEntries, memoryDb } from '../test-helpers.ts'
import { buildExport } from './run.ts'

const SAMPLE_ZIP = resolve(import.meta.dirname, '../../../../fixtures/sample-dayone-export.zip')

let dataDir: string
let tmp: string
let h: ReturnType<typeof memoryDb>
let userId: string
beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'cairn-export-data-'))
  tmp = mkdtempSync(join(tmpdir(), 'cairn-export-zip-'))
  h = memoryDb()
  photoQuality(h.db).set('original') // the round trip compares original files
  userId = (await addUser(h.db, 'alice')).id
  const source = await openZipSource(SAMPLE_ZIP)
  try {
    await importDayOne({
      source,
      db: h.db,
      dataDir,
      userId,
      defaultTimezone: 'America/Denver',
      now: 1_700_000_000_000,
    })
  } finally {
    await source.close()
  }
})
afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true })
  rmSync(tmp, { recursive: true, force: true })
})

/** Runs an export for `uid`, saves the zip and opens it with the importer's own reader. */
async function exportZip(media: boolean, uid = userId, journalId?: string, entryId?: string) {
  const { stream, filename, missing } = await buildExport({
    db: h.db,
    dataDir,
    userId: uid,
    journalId,
    entryId,
    media,
    now: Date.UTC(2026, 9, 30, 12),
  })
  const chunks: Buffer[] = []
  for await (const c of stream) chunks.push(c as Buffer)
  const file = join(tmp, filename)
  writeFileSync(file, Buffer.concat(chunks))
  return { filename, missing, source: await openZipSource(file), file }
}

/** Every file name in a zip. */
const zipNames = (file: string) =>
  new Promise<string[]>((resolve, reject) =>
    yauzl.open(file, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err)
      const names: string[] = []
      zip.on('entry', (e: yauzl.Entry) => {
        names.push(e.fileName)
        zip.readEntry()
      })
      zip.on('end', () => resolve(names))
      zip.on('error', reject)
      zip.readEntry()
    }),
  )

const journalJson = async (source: ExportSource, name: string) =>
  (await source.readJson(`${name}.json`)) as {
    entries: Record<string, unknown>[]
    cairn?: Record<string, unknown>
  }

describe('export', () => {
  it('has one JSON per journal, and every photo file, named by its md5', async () => {
    const { filename, source, file: zipFile } = await exportZip(true)
    expect(filename).toBe('cairn-export-2026-10-30.zip')
    // Day One imports every .json anywhere in the archive as a journal (a manifest.json hung its
    // import, then showed up as a journal from inside a folder), so only journals may end in .json.
    expect((await zipNames(zipFile)).filter((n) => n.endsWith('.json')).sort()).toEqual([
      'Sample Journal.json',
      'Travel.json',
    ])
    expect(source.journalFiles().sort()).toEqual(['Sample Journal.json', 'Travel.json'])
    const all = [
      ...(await journalJson(source, 'Sample Journal')).entries,
      ...(await journalJson(source, 'Travel')).entries,
    ]
    expect(all).toHaveLength(15)
    // Attachments go in Day One's lists and folders, with the placeholder forms it writes.
    const att = all.find((e) => String(e.text).startsWith('# Attachments'))!
    const lists = { videos: 'videos', audios: 'audios', pdfAttachments: 'pdfs' } as const
    for (const [key, folder] of Object.entries(lists)) {
      const items = att[key] as { md5: string; type: string; identifier: string }[]
      expect(items.length, key).toBeGreaterThan(0)
      for (const m of items)
        expect(await source.readFileBytes(`${folder}/${m.md5}.${m.type}`)).not.toBeNull()
    }
    const pdfs = att.pdfAttachments as { pdfName: string; identifier: string }[]
    expect(pdfs.map((p) => p.pdfName)).toEqual(['Sample receipt', 'Loose manual'])
    expect(att.text).toContain(`![](dayone-moment:/pdfAttachment/${pdfs[0]!.identifier})`)
    expect(att.text).toMatch(/!\[\]\(dayone-moment:\/video\/[0-9A-F]{32}\)/)
    expect(att.text).toMatch(/A voice memo !\[\]\(dayone-moment:\/audio\/[0-9A-F]{32}\) from/)
    const photos = all.flatMap(
      (e) => (e.photos ?? []) as { md5: string; type: string; date: string }[],
    )
    expect(photos).toHaveLength(7)
    // The import ran at 2023-11-14; a photo with no date of its own gets its entry's, not that.
    for (const p of photos) expect(p.date).not.toMatch(/^2023-11-14/)
    for (const p of photos)
      expect(await source.readFileBytes(`photos/${p.md5}.${p.type}`)).not.toBeNull()
    await source.close()
  })

  it('imports back into Cairn with the same entries, text, places, weather and photos', async () => {
    const { source } = await exportZip(true)
    const other = await addUser(h.db, 'other')
    const report = await importDayOne({
      source,
      db: h.db,
      dataDir,
      userId: other.id,
      defaultTimezone: 'UTC',
    })
    await source.close()
    expect(report.failures).toEqual([])
    expect(report.photosMissing).toBe(0)
    expect(report.attachmentsMissing).toBe(0)
    expect(report.attachmentsImported).toBe(4)
    expect(report.unmappedKeys).toEqual({})

    const a = createRepos(h.db, userId)
    const b = createRepos(h.db, other.id)
    const byUuid = (r: ReturnType<typeof createRepos>, uid: string) =>
      new Map(
        listEntries(h.db, uid, { limit: 100 }).map((c) => {
          const d = r.entries.detail(c.id)!
          return [d.entry.sourceId!, d] as const
        }),
      )
    const [ea, eb] = [byUuid(a, userId), byUuid(b, other.id)]
    expect(eb.size).toBe(15)
    // Media ids differ between the two imports; compare the text with them blanked.
    const blank = (s: string) => s.replace(/(photo|attachment):[A-Za-z0-9-]+/g, '$1:_')
    for (const [uuid, x] of ea) {
      const y = eb.get(uuid)!
      expect(y, uuid).toBeDefined()
      expect(blank(y.entry.bodyMd)).toBe(blank(x.entry.bodyMd))
      expect(y.entry.createdAt).toBe(x.entry.createdAt)
      expect(y.entry.timezone).toBe(x.entry.timezone)
      expect([y.entry.starred, y.entry.pinned, y.entry.allDay]).toEqual([
        x.entry.starred,
        x.entry.pinned,
        x.entry.allDay,
      ])
      expect(y.tags).toEqual(x.tags)
      expect(y.location?.latitude).toBe(x.location?.latitude)
      expect(y.location?.placeName).toBe(x.location?.placeName)
      expect(y.weather?.condition).toBe(x.weather?.condition)
      expect(y.weather?.tempC).toBe(x.weather?.tempC)
      expect(y.photos.map((p) => p.sha256)).toEqual(x.photos.map((p) => p.sha256))
      const files = (d: typeof x) => d.attachments.map((f) => [f.kind, f.filename, f.sha256])
      expect(files(y)).toEqual(files(x))
    }
  })

  it('JSON-only leaves out the photo files but still lists the photos', async () => {
    const { filename, source } = await exportZip(false)
    expect(filename).toBe('cairn-export-2026-10-30-json.zip')
    const photos = [
      ...(await journalJson(source, 'Sample Journal')).entries,
      ...(await journalJson(source, 'Travel')).entries,
    ].flatMap((e) => (e.photos ?? []) as { md5: string; type: string }[])
    expect(photos).toHaveLength(7)
    expect(await source.readFileBytes(`photos/${photos[0]!.md5}.${photos[0]!.type}`)).toBeNull()
    await source.close()
  })
})

describe('Cairn extras', () => {
  it('adds the cairn extras and the journal settings', async () => {
    const repos = createRepos(h.db, userId)
    const j = repos.journals.list()[0]!
    repos.journals.update(j.id, { color: '#7B7B45' })
    const mine = repos.entries.create({
      journalId: j.id,
      bodyMd: 'native entry',
      timezone: 'America/Denver',
      mood: 'anxious',
      location: {
        latitude: 1,
        longitude: 2,
        placeName: 'Home',
        locality: null,
        region: null,
        country: null,
        address: null,
        googlePlaceId: 'place-1',
      },
      weather: { condition: 'rain', tempC: 12, isDay: null },
    })
    // A label only an import can set (Day One's userLabel).
    h.sqlite
      .prepare("UPDATE entry_location SET user_label = 'my spot' WHERE entry_id = ?")
      .run(mine.id)

    const { filename, source } = await exportZip(true)
    expect(filename).toBe('cairn-export-2026-10-30.zip')
    const file = await journalJson(source, j.name)
    expect(file.cairn).toMatchObject({
      journal: { name: j.name, color: '#7B7B45' },
    })
    const entry = file.entries.find((e) => (e.cairn as { id: string }).id === mine.id) as {
      uuid: string
      text: string
      weather: { weatherCode: string; temperatureCelsius: number }
      location: { placeName: string; cairn: { userLabel: string } }
      cairn: { mood: string; source: string }
    }
    expect(entry.cairn).toMatchObject({ mood: 'anxious', source: 'native' })
    expect(entry.uuid).toMatch(/^[0-9A-F]{32}$/)
    expect(entry.weather).toMatchObject({ weatherCode: 'Rain', temperatureCelsius: 12 })
    expect(entry.location.cairn.userLabel).toBe('my spot')

    await source.close()
  })

  it('never contains credentials', async () => {
    const { passwordHash } = h.sqlite
      .prepare('SELECT password_hash AS passwordHash FROM user WHERE id = ?')
      .get(userId) as { passwordHash: string }
    h.sqlite
      .prepare(
        "INSERT INTO app_setting (key, value, updated_at) VALUES ('google_api_key','SECRETKEY',0)",
      )
      .run()
    const { source } = await exportZip(false)
    const text = JSON.stringify([
      await journalJson(source, 'Sample Journal'),
      await journalJson(source, 'Travel'),
    ])
    expect(text).not.toContain(passwordHash)
    expect(text).not.toContain('SECRETKEY')
    expect(text).not.toMatch(/passwordHash|password_hash|sessions?\b/i)
    await source.close()
  })

  it('leaves out deleted entries and photos whose file is gone, and says so', async () => {
    const repos = createRepos(h.db, userId)
    const gone = repos.entries.timeline({ limit: 100 }).items.find((c) => c.photoCount > 0)!
    const photo = repos.entries.detail(gone.id)!.photos[0]!
    rmSync(join(dataDir, photo.originalPath))
    const deleted = listEntries(h.db, userId, { limit: 100 }).find((c) => c.id !== gone.id)!
    repos.entries.softDelete(deleted.id)

    const { source, missing } = await exportZip(true)
    // Reported to the caller (the route logs it), and the export still goes ahead.
    expect(missing.map((m) => m.id)).toEqual([photo.id])
    const entries = [
      ...(await journalJson(source, 'Sample Journal')).entries,
      ...(await journalJson(source, 'Travel')).entries,
    ]
    expect(entries).toHaveLength(14)
    const entry = entries.find((e) => (e.cairn as { id: string }).id === gone.id)!
    expect(JSON.stringify(entry)).not.toContain(photo.id)
    expect(entry.text).not.toContain('dayone-moment://' + (photo.sourceRef ?? '?'))
    await source.close()
  })
})

describe('one journal', () => {
  it('exports only that journal, its photos and its entries', async () => {
    const repos = createRepos(h.db, userId)
    const travel = repos.journals.list().find((j) => j.name === 'Travel')!
    const { filename, source, file } = await exportZip(true, userId, travel.id)
    expect(filename).toBe('cairn-export-travel-2026-10-30.zip')
    expect(source.journalFiles()).toEqual(['Travel.json'])
    const entries = (await journalJson(source, 'Travel')).entries
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.length).toBeLessThan(15)
    const photos = entries.flatMap((e) => (e.photos ?? []) as { md5: string; type: string }[])
    expect(photos.length).toBeGreaterThan(0)
    // Exactly this journal's photo files are in the zip, and no one else's.
    expect((await zipNames(file)).filter((n) => n.startsWith('photos/')).sort()).toEqual(
      [...new Set(photos.map((p) => `photos/${p.md5}.${p.type}`))].sort(),
    )
    await source.close()
  })

  it("leaves a name with nothing ASCII out of the file name, and can't reach another user's journal", async () => {
    const repos = createRepos(h.db, userId)
    const emoji = repos.journals.create({ name: '🌲🌲' })
    expect((await exportZip(false, userId, emoji.id)).filename).toBe(
      'cairn-export-2026-10-30-json.zip',
    )
    const other = await addUser(h.db, 'someone-else')
    const { source } = await exportZip(true, other.id, emoji.id)
    expect(source.journalFiles()).toEqual([])
    await source.close()
  })
})

describe('one entry', () => {
  it('is a zip of one journal file with just that entry and its files, named for its day and first line', async () => {
    const all = listEntries(h.db, userId)
    const attachments = all.find((e) => e.bodyMd.startsWith('# Attachments'))!
    const { filename, source, file } = await exportZip(true, userId, undefined, attachments.id)
    expect(filename).toMatch(/^cairn-entry-\d{4}-\d\d-\d\d-attachments\.zip$/)
    const names = await zipNames(file)
    expect(names.filter((n) => n.endsWith('.json'))).toHaveLength(1)
    const entries = (await journalJson(source, source.journalFiles()[0]!.replace(/\.json$/, '')))
      .entries
    expect(entries).toHaveLength(1)
    expect(String(entries[0]!.text)).toMatch(/^# Attachments/)
    // Only this entry's files travel with it.
    const media = ['videos', 'audios', 'pdfAttachments', 'photos'].flatMap(
      (k) => (entries[0]![k] ?? []) as { md5: string }[],
    )
    expect(media.length).toBeGreaterThan(0)
    expect(names.filter((n) => !n.endsWith('.json'))).toHaveLength(
      new Set(media.map((m) => m.md5)).size,
    )
    await source.close()
  })

  it('is still a zip with no media, and the title slug is capped', async () => {
    const repos = createRepos(h.db, userId)
    const journal = repos.journals.list()[0]!
    const e = repos.entries.create({
      journalId: journal.id,
      bodyMd: `## ${'word '.repeat(30)}\n\nbody`,
      timezone: 'America/Denver',
    })
    const { filename, source, file } = await exportZip(true, userId, undefined, e.id)
    const slug = filename.replace(/^cairn-entry-\d{4}-\d\d-\d\d-/, '').replace(/\.zip$/, '')
    expect(slug.length).toBeLessThanOrEqual(40)
    expect(slug).toMatch(/^word-word/)
    expect(await zipNames(file)).toHaveLength(1)
    await source.close()
  })

  it("exports nothing for another user's entry", async () => {
    const entry = listEntries(h.db, userId)[0]!
    const other = await addUser(h.db, 'someone-else')
    const { source } = await exportZip(true, other.id, undefined, entry.id)
    expect(source.journalFiles()).toEqual([])
    await source.close()
  })
})

describe('restoring from the export', () => {
  /** An entry written in Cairn, with everything Day One's format has no place for. */
  async function writeNativeEntries() {
    const repos = createRepos(h.db, userId)
    const journal = repos.journals.create({
      name: 'Trips/2026: ✨ "best" of',
      color: '#a8654f',
      description: 'Where we went',
    })
    repos.journals.update(journal.id, { sortOrder: 7 })
    const sample = readdirSync(join(dataDir, 'photos', userId, 'originals'))[0]!
    const photo = repos.photos.add(
      await ingestUpload(
        dataDir,
        userId,
        readFileSync(join(dataDir, 'photos', userId, 'originals', sample)),
        'original',
      ),
    )
    const entry = repos.entries.create({
      journalId: journal.id,
      bodyMd: `Hiked up.\n\n![](photo:${photo.id})\n`,
      timezone: 'America/Denver',
      createdAt: 1_760_000_000_123, // not a whole second
      mood: 'anxious',
      location: {
        latitude: 39.5,
        longitude: -105.1,
        placeName: 'Trailhead',
        locality: null,
        region: null,
        country: null,
        address: null,
        googlePlaceId: 'place-1',
      },
      weather: { condition: 'rain', tempC: 9, isDay: true },
    })
    h.sqlite
      .prepare("UPDATE entry_location SET user_label = 'the usual spot' WHERE entry_id = ?")
      .run(entry.id)
    h.sqlite
      .prepare("UPDATE entry SET mood_suggested = 2, mood_suggested_by = 'model-x' WHERE id = ?")
      .run(entry.id)
    h.sqlite
      .prepare(
        "UPDATE entry_weather SET source = 'google', source_code = 'LIGHT_RAIN', feels_like_c = 7.5 WHERE entry_id = ?",
      )
      .run(entry.id)
    repos.journals.update(journal.id, { archived: true })
    return { journal, entry, photo }
  }

  async function restoreInto(uid: string) {
    const { source } = await exportZip(true)
    try {
      return await importDayOne({ source, db: h.db, dataDir, userId: uid, defaultTimezone: 'UTC' })
    } finally {
      await source.close()
    }
  }

  it('brings back mood, labels, weather source, photo dates and the journal as it was', async () => {
    const { journal, entry, photo } = await writeNativeEntries()
    const other = await addUser(h.db, 'restored')
    const report = await restoreInto(other.id)
    expect(report.failures).toEqual([])
    expect(report.unmappedKeys).toEqual({})

    const b = createRepos(h.db, other.id)
    // The journal keeps its real name (not the file name), colour, order and archived state.
    const restored = b.journals
      .list({ includeArchived: true })
      .find((j) => j.name === journal.name)!
    expect(restored).toMatchObject({ color: '#a8654f', description: 'Where we went', sortOrder: 7 })
    expect(restored.archivedAt).not.toBeNull()

    const got = b.entries.detail(
      listEntries(h.db, other.id, { journalId: restored.id, limit: 10 })[0]!.id,
    )!
    expect(got.entry).toMatchObject({
      source: 'native',
      sourceRaw: null,
      moodKey: 'anxious',
      moodSuggested: 2,
      moodSuggestedBy: 'model-x',
      createdAt: 1_760_000_000_123,
      timezone: 'America/Denver',
    })
    expect(got.location).toMatchObject({
      placeName: 'Trailhead',
      userLabel: 'the usual spot',
      googlePlaceId: 'place-1',
    })
    // Google's weather stays Google's (so a move can refetch it); it is not turned into Day One's.
    expect(got.weather).toMatchObject({
      source: 'google',
      sourceCode: 'LIGHT_RAIN',
      condition: 'rain',
      isDay: true,
      feelsLikeC: 7.5,
      tempC: 9,
      raw: null,
    })
    const [p] = got.photos
    const original = createRepos(h.db, userId).photos.get(photo.id)!
    expect(p).toMatchObject({
      sha256: original.sha256,
      takenAt: original.takenAt,
      latitude: original.latitude,
    })
    expect(got.entry.bodyMd).toContain(`photo:${p!.id}`)
    expect(entry.id).not.toBe(got.entry.id) // a new row, not the old id
  })

  it('imports nothing twice: not into the same account, not into one that already has it', async () => {
    await writeNativeEntries()
    // Same account: Day One entries match by uuid, written-in-Cairn ones by the id they came from.
    const same = await restoreInto(userId)
    expect(same.journals.reduce((n, j) => n + j.imported, 0)).toBe(0)
    expect(same.photosImported).toBe(0)

    const other = await addUser(h.db, 'restored-twice')
    const first = await restoreInto(other.id)
    const second = await restoreInto(other.id)
    expect(first.journals.reduce((n, j) => n + j.imported, 0)).toBe(16)
    expect(second.journals.reduce((n, j) => n + j.imported, 0)).toBe(0)
  })

  it('a second export of a restored account has no stale extras', async () => {
    await writeNativeEntries()
    const other = await addUser(h.db, 'restored-export')
    await restoreInto(other.id)
    const { source } = await exportZip(true, other.id)
    const files = await Promise.all(source.journalFiles().map((f) => source.readJson(f)))
    await source.close()
    // A `cairn` object never contains another one: carried-over keys from the first export are
    // dropped, not stacked.
    const nested: string[] = []
    const walk = (v: unknown, inCairn: boolean, path: string) => {
      if (Array.isArray(v)) return v.forEach((x, i) => walk(x, inCairn, `${path}[${i}]`))
      if (typeof v !== 'object' || v === null) return
      for (const [k, x] of Object.entries(v)) {
        if (k === 'cairn' && inCairn) nested.push(`${path}.${k}`)
        walk(x, inCairn || k === 'cairn', `${path}.${k}`)
      }
    }
    walk(files, false, '$')
    expect(nested).toEqual([])
    const text = JSON.stringify(files)
    expect(text).toContain('the usual spot')
  })
})

describe('weather codes', () => {
  it('every known condition survives a trip through Day One wording', () => {
    for (const c of WEATHER_CONDITIONS.filter((c) => c !== 'unknown')) {
      expect(mapDayOneWeather(toDayOneWeatherCode(c)!).condition).toBe(c)
    }
    expect(toDayOneWeatherCode('unknown')).toBeNull()
  })
})
