import type { Db } from '../../db/index.ts'
import { createRepos } from '../../repo/index.ts'
import { ATTACHMENT_LISTS, JournalExtrasSchema } from './map.ts'
import type { ExportSource } from './source.ts'

/** The upload isn't something this importer reads (not a zip, or no Day One journal in it). */
export class UnsupportedExportError extends Error {}
/**
 * The export unpacks to more than the server takes from Settings (journal files too big to parse
 * in memory, or media far past the upload limit); the CLI is the way for that one.
 */
export class ExportTooLargeError extends Error {}

export interface DayOnePreview {
  journals: {
    name: string
    entries: number
    alreadyImported: number
    exists: boolean
    archived: boolean
  }[]
  photos: number
  attachments: number
  total: number
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * What a Day One export would import into this user's account, without writing anything: each
 * journal file read and counted the way `importDayOne` names it. Throws UnsupportedExportError
 * when no root `.json` file has an `entries` list (so a random zip is refused before it starts),
 * and ExportTooLargeError when the journal files together are over `maxJsonBytes`.
 */
export async function previewDayOne(
  source: ExportSource,
  db: Db,
  userId: string,
  { maxJsonBytes = Infinity } = {},
): Promise<DayOnePreview> {
  const files = source.journalFiles()
  if (files.length === 0) throw new UnsupportedExportError('no journal files')
  const jsonBytes = files.reduce((n, f) => n + (source.fileSize(f) ?? 0), 0)
  if (jsonBytes > maxJsonBytes) throw new ExportTooLargeError()

  const repos = createRepos(db, userId)
  const out: DayOnePreview = { journals: [], photos: 0, attachments: 0, total: 0 }
  for (const file of files) {
    let raw: unknown
    try {
      raw = await source.readJson(file)
    } catch {
      throw new UnsupportedExportError(`${file} isn't JSON`)
    }
    if (!isObject(raw) || !Array.isArray(raw.entries))
      throw new UnsupportedExportError(`${file} has no entries`)
    const extras = JournalExtrasSchema.safeParse(raw.cairn).data?.journal
    const name = extras?.name ?? file.replace(/\.json$/, '')
    const journal = repos.journals.findByName(name)
    let alreadyImported = 0
    for (const e of raw.entries) {
      if (!isObject(e)) continue
      if (Array.isArray(e.photos)) out.photos += e.photos.length
      for (const list of ATTACHMENT_LISTS) {
        const files = e[list.key]
        if (Array.isArray(files)) out.attachments += files.length
      }
      const cairnId = isObject(e.cairn) && typeof e.cairn.id === 'string' ? e.cairn.id : null
      if (typeof e.uuid === 'string' && repos.imports.hasSource(e.uuid, cairnId)) alreadyImported++
    }
    out.journals.push({
      name,
      entries: raw.entries.length,
      alreadyImported,
      exists: !!journal,
      archived: journal ? !!journal.archivedAt : !!extras?.archivedAt,
    })
    out.total += raw.entries.length
  }
  return out
}
