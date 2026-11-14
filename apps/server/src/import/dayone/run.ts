import { createHash } from 'node:crypto'
import { processImage, type ProcessedImage } from '../../photos/pipeline.ts'
import { photoQuality, storeOriginal } from '../../photos/quality.ts'
import { photoPath, storeOnce } from '../../photos/storage.ts'
import type { Db } from '../../db/index.ts'
import { createRepos } from '../../repo/index.ts'
import type { NewAttachment, NewPhoto } from '../../repo/imports.ts'
import { storeAttachmentStream } from '../../attachments/upload.ts'
import type { ExportSource } from './source.ts'
import {
  ATTACHMENT_LISTS,
  DayOneEntrySchema,
  JournalExtrasSchema,
  KNOWN_ENTRY_KEYS,
  mapLocation,
  mapWeather,
  mimeFor,
  parseDate,
  rewritePlaceholders,
  validTimezone,
  type DayOneEntry,
} from './map.ts'

export interface ImportOptions {
  source: ExportSource
  db: Db
  dataDir: string
  userId: string
  /** Timezone for entries whose own is missing or invalid. */
  defaultTimezone: string
  /** Journal names to import as archived. */
  archived?: string[]
  /**
   * Import again entries whose earlier copy was emptied from the trash (the CLI's `--force`).
   * Live entries and ones still in the trash are skipped as always.
   */
  reimportPurged?: boolean
  /**
   * The largest photo and attachment file to take (Import from Settings sets both; the CLI has no
   * limit). An entry with a bigger one fails, and is reported, rather than losing the file.
   */
  maxPhotoBytes?: number
  maxAttachmentBytes?: number
  now?: number
  /** After each entry: how many of this journal's are done, of how many, and its name. */
  onProgress?: (done: number, total: number, journal: string) => void
}

export interface JournalReport {
  name: string
  archived: boolean
  total: number
  imported: number
  skipped: number
  failed: number
}

export interface ImportReport {
  journals: JournalReport[]
  photosImported: number
  /** Photos listed in the JSON whose file wasn't in the export. */
  photosMissing: number
  attachmentsImported: number
  /** Videos, audio and PDFs listed in the JSON whose file wasn't in the export. */
  attachmentsMissing: number
  brokenPlaceholders: number
  /** Entry keys this importer doesn't know, with entry counts. They survive in source_raw. */
  unmappedKeys: Record<string, number>
  warnings: string[]
  failures: { journal: string; uuid: string; error: string }[]
}

const SAFE = /^[A-Za-z0-9_-]+$/

export async function importDayOne(opts: ImportOptions): Promise<ImportReport> {
  const { source, db, userId } = opts
  const repos = createRepos(db, userId)
  const quality = photoQuality(db).get()
  const now = opts.now ?? Date.now()
  const report: ImportReport = {
    journals: [],
    photosImported: 0,
    photosMissing: 0,
    attachmentsImported: 0,
    attachmentsMissing: 0,
    brokenPlaceholders: 0,
    unmappedKeys: {},
    warnings: [],
    failures: [],
  }
  const warn = (m: string) => report.warnings.push(m)
  // Checked before a file is read: its size is known up front (a zip's is enforced by yauzl), so
  // a small zip can't unpack a huge file into memory or onto the disk.
  const assertFits = (file: string, max: number | undefined) => {
    if (max !== undefined && (source.fileSize(file) ?? 0) > max)
      throw new Error(
        `${file} is over ${Math.floor(max / (1024 * 1024))} MB; import this export from the command line`,
      )
  }
  const archivedNames = new Set(opts.archived ?? [])
  const files = source.journalFiles()
  if (files.length === 0) throw new Error('no journal .json files found in the export')

  for (const file of files) {
    const raw = (await source.readJson(file)) as { entries?: unknown }
    const rawEntries = Array.isArray(raw?.entries) ? raw.entries : []
    // Our own export names the journal (the file name had characters stripped) and carries its
    // look. That only applies to a journal created here; one that exists keeps its settings.
    const extras = JournalExtrasSchema.safeParse((raw as { cairn?: unknown })?.cairn).data?.journal
    const name = extras?.name ?? file.replace(/\.json$/, '')
    const wantArchived =
      archivedNames.delete(name) || archivedNames.delete(file.replace(/\.json$/, ''))
    const existing = repos.journals.findByName(name)
    let journal =
      existing ??
      repos.journals.create(
        { name, color: extras?.color, icon: extras?.icon, description: extras?.description },
        now,
      )
    if (!existing && extras) {
      if (extras.sortOrder)
        journal = repos.journals.update(journal.id, { sortOrder: extras.sortOrder }, now)!
      if (extras.archivedAt) journal = repos.journals.update(journal.id, { archived: true }, now)!
    }
    if (wantArchived && !journal.archivedAt) {
      journal = repos.journals.update(journal.id, { archived: true }, now)!
    }
    const jr: JournalReport = {
      name,
      archived: !!journal.archivedAt,
      total: rawEntries.length,
      imported: 0,
      skipped: 0,
      failed: 0,
    }
    report.journals.push(jr)

    let done = 0
    for (const item of rawEntries) {
      const parsed = DayOneEntrySchema.safeParse(item)
      const uuid = parsed.success ? parsed.data.uuid : String((item as { uuid?: unknown })?.uuid)
      try {
        if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'invalid entry')
        const outcome = await importOne(parsed.data, item, journal.id)
        jr[outcome]++
      } catch (e) {
        jr.failed++
        report.failures.push({ journal: name, uuid, error: (e as Error).message })
      }
      opts.onProgress?.(++done, rawEntries.length, name)
    }
  }
  for (const name of archivedNames) warn(`--archived "${name}" matched no journal in the export`)
  return report

  async function importOne(
    e: DayOneEntry,
    rawItem: unknown,
    journalId: string,
  ): Promise<'imported' | 'skipped'> {
    for (const k of Object.keys(rawItem as object)) {
      if (!KNOWN_ENTRY_KEYS.has(k)) report.unmappedKeys[k] = (report.unmappedKeys[k] ?? 0) + 1
    }
    // Our own export has the dates to the millisecond; Day One's are rounded to the second.
    const createdAt = e.cairn?.createdAt ?? parseDate(e.creationDate)
    if (createdAt === null) throw new Error(`bad creationDate "${e.creationDate}"`)

    let timezone = e.timeZone
    if (!validTimezone(timezone)) {
      warn(`${e.uuid}: timezone "${e.timeZone ?? ''}" invalid, used ${opts.defaultTimezone}`)
      timezone = opts.defaultTimezone
    }

    // Already imported: don't re-copy photos or touch it.
    const photos: NewPhoto[] = []
    const photoIdBySource = new Map<string, string>()
    const reimportPurged = opts.reimportPurged ?? false
    const alreadyThere = repos.imports.hasSource(e.uuid, e.cairn?.id, { reimportPurged })
    if (!alreadyThere) {
      const media = [...(e.photos ?? [])].sort(
        (a, b) => (a.orderInEntry ?? 0) - (b.orderInEntry ?? 0),
      )
      for (const m of media) {
        if (!SAFE.test(m.md5) || !SAFE.test(m.type)) throw new Error(`unsafe photo name ${m.md5}`)
        assertFits(`photos/${m.md5}.${m.type}`, opts.maxPhotoBytes)
        const bytes = await source.readFileBytes(`photos/${m.md5}.${m.type}`)
        if (!bytes) {
          report.photosMissing++
          warn(`${e.uuid}: photo file photos/${m.md5}.${m.type} not in export`)
          continue
        }
        const sha256 = createHash('sha256').update(bytes).digest('hex')
        const ext = m.type.toLowerCase()
        // As uploads do: kept as is, or compressed, per the server's photo quality.
        const original = await storeOriginal(
          opts.dataDir,
          userId,
          { bytes, sha256, ext, mime: mimeFor(ext) },
          quality,
        )

        // A photo we can't decode keeps its original; Phase 3 falls back to it.
        let img: ProcessedImage | null = null
        try {
          img = await processImage(bytes)
        } catch (err) {
          warn(`${e.uuid}: no derivatives for ${m.identifier}: ${(err as Error).message}`)
        }
        const displayPath = img ? photoPath(userId, 'display', sha256, 'webp') : null
        const thumbPath = img ? photoPath(userId, 'thumb', sha256, 'webp') : null
        if (img) {
          storeOnce(opts.dataDir, displayPath!, img.display)
          storeOnce(opts.dataDir, thumbPath!, img.thumb)
        }
        const id = repos.imports.newMediaId(createdAt + photos.length)
        photoIdBySource.set(m.identifier, id)
        photos.push({
          id,
          position: photos.length,
          ...original,
          displayPath,
          thumbPath,
          // Day One reports 0x0 for most photos, so prefer the real dimensions from the file.
          width: img?.width ?? (m.width || null),
          height: img?.height ?? (m.height || null),
          sha256,
          // Our own export says whether the photo had a date of its own; its `date` falls back to
          // the entry's, which is no reason to call that when it was taken.
          takenAt:
            m.cairn?.takenAt !== undefined
              ? m.cairn.takenAt
              : (parseDate(m.date) ?? img?.takenAt ?? null),
          latitude: m.cairn?.latitude !== undefined ? m.cairn.latitude : (img?.latitude ?? null),
          longitude:
            m.cairn?.longitude !== undefined ? m.cairn.longitude : (img?.longitude ?? null),
          sourceRef: m.identifier,
        })
      }
    }

    // Videos, audio and PDFs: the original only, no derivatives.
    const attachments: NewAttachment[] = []
    const attachmentBySource = new Map<string, { id: string; filename: string }>()
    if (!alreadyThere) {
      for (const list of ATTACHMENT_LISTS) {
        const media = [...(e[list.key] ?? [])].sort(
          (a, b) => (a.orderInEntry ?? 0) - (b.orderInEntry ?? 0),
        )
        for (const m of media) {
          if (!SAFE.test(m.md5) || !SAFE.test(m.type))
            throw new Error(`unsafe ${list.kind} name ${m.md5}`)
          const file = `${list.folder}/${m.md5}.${m.type}`
          assertFits(file, opts.maxAttachmentBytes)
          // Streamed: a Day One video can be hundreds of MB.
          const stream = await source.openFile(file)
          if (!stream) {
            report.attachmentsMissing++
            warn(`${e.uuid}: ${list.kind} file ${file} not in export`)
            continue
          }
          const ext = m.type.toLowerCase()
          const stored = await storeAttachmentStream(opts.dataDir, userId, stream, {
            kind: list.kind,
            ext,
            mime: mimeFor(ext),
          })
          if (!stored.sniffed) warn(`${e.uuid}: ${file} is not a PDF, MP4, MOV or M4A; kept as is`)
          const filename =
            m.cairn?.filename ?? (m.pdfName ? `${m.pdfName}.${ext}` : `${list.kind}.${ext}`)
          const id = repos.imports.newMediaId(createdAt + photos.length + attachments.length)
          attachmentBySource.set(m.identifier, { id, filename })
          attachments.push({
            id,
            kind: stored.kind,
            position: attachments.length,
            path: stored.path,
            mime: stored.mime,
            bytes: stored.bytes,
            sha256: stored.sha256,
            filename,
            sourceRef: m.identifier,
          })
        }
      }
    }

    const native = e.cairn?.source === 'native'
    const rewritten = rewritePlaceholders(e.text ?? '', photoIdBySource, attachmentBySource)
    if (rewritten.broken) {
      report.brokenPlaceholders += rewritten.broken
      warn(`${e.uuid}: removed ${rewritten.broken} placeholder(s) with no matching media`)
    }

    let weather = null
    if (e.weather) {
      const w = mapWeather(e.weather)
      weather = w.row
      if (w.unmappedCode) warn(`${e.uuid}: unmapped weather code "${w.unmappedCode}"`)
    }

    const outcome = repos.imports.importEntry(
      {
        sourceId: e.uuid,
        journalId,
        bodyMd: rewritten.text,
        createdAt,
        modifiedAt: e.cairn?.modifiedAt ?? parseDate(e.modifiedDate) ?? createdAt,
        timezone,
        starred: e.starred ?? false,
        pinned: e.isPinned ?? false,
        allDay: e.isAllDay ?? false,
        creationDevice: e.creationDevice ?? null,
        // An entry written in Cairn has no Day One original to keep.
        source: native ? 'native' : 'dayone',
        cairnId: e.cairn?.id ?? null,
        mood: e.cairn?.mood ?? null,
        moodSuggested: e.cairn?.moodSuggested ?? null,
        moodSuggestedBy: e.cairn?.moodSuggestedBy ?? null,
        sourceRaw: native ? null : JSON.stringify(rawItem),
        tags: (e.tags ?? []).map((t) => t.trim()).filter(Boolean),
        location: e.location ? mapLocation(e.location) : null,
        weather,
        photos,
        attachments,
      },
      now,
      { reimportPurged },
    )
    if (outcome === 'imported') {
      report.photosImported += photos.length
      report.attachmentsImported += attachments.length
    }
    return outcome
  }
}
