import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { extname, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import yazl from 'yazl'
import type { Db } from '../db/index.ts'
import { createRepos } from '../repo/index.ts'
import type { AttachmentKind } from '@cairn/shared'
import { ATTACHMENT_LISTS } from '../import/dayone/map.ts'
import { entryJson, journalFileNames, journalShell, type MediaFile } from './map.ts'

/** Entries read from the database per batch while a journal's file is written. */
const EXPORT_BATCH = 200
const EMPTY_ENTRIES = '"entries": []'

export interface ExportOptions {
  db: Db
  dataDir: string
  userId: string
  /** Export just this journal. It must be one of the user's (the route checks); else nothing is exported. */
  journalId?: string
  /** Export just this entry, as a journal file holding it alone. It must be one of the user's (the route checks). */
  entryId?: string
  /** Put the original photo and attachment files in the archive. Off = JSON only (still listed). */
  media: boolean
  now?: number
}

interface Missing {
  id: string
  kind: 'photo' | AttachmentKind
  entryId: string
  path: string
}

export interface ExportResult {
  filename: string
  /** Photos and attachments whose file wasn't on disk; they are left out of the export. */
  missing: Missing[]
  /** The zip, produced as it is read; there is no Content-Length. */
  stream: Readable
}

/**
 * md5 (the name Day One gives a media file) of every original, in one read each, keyed by the
 * data-dir path. `folder` is where the file goes in the archive. A file that is missing, or
 * outside the user's own photo and attachment folders, is absent from the result.
 */
export async function hashMediaFiles(
  dataDir: string,
  userId: string,
  items: Iterable<{ rel: string; folder: string }>,
): Promise<Map<string, MediaFile & { abs: string }>> {
  const roots = ['photos', 'attachments'].map((d) => `${resolve(dataDir, d, userId)}${sep}`)
  const out = new Map<string, MediaFile & { abs: string }>()
  for (const { rel, folder } of items) {
    if (out.has(rel)) continue
    const abs = resolve(dataDir, rel)
    if (!roots.some((r) => abs.startsWith(r))) continue
    const md5 = createHash('md5')
    let bytes = 0
    try {
      for await (const chunk of createReadStream(abs)) {
        md5.update(chunk)
        bytes += chunk.length
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw e
    }
    const ext = extname(abs).slice(1).toLowerCase()
    const digest = md5.digest('hex')
    out.set(rel, {
      abs,
      path: `${folder}/${digest}.${ext}`,
      md5: digest,
      bytes,
      ext,
    })
  }
  return out
}

/** Lower-case ASCII words joined by dashes, at most `max` long, for a file name. */
function slugify(text: string, max: number): string {
  return text
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, max)
    .replace(/-$/, '')
    .toLowerCase()
}

/** The first line with any text, minus markdown heading, list and quote marks. */
function entryTitle(body: string): string {
  const line =
    body
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .split('\n')
      .find((l) => l.replace(/^[\s#>*+-]+/, '').trim()) ?? ''
  return line.replace(/^[\s#>*+-]+/, '')
}

export async function buildExport(opts: ExportOptions): Promise<ExportResult> {
  const { db, userId } = opts
  const now = opts.now ?? Date.now()
  const repo = createRepos(db, userId).export
  const single = opts.entryId ? repo.entryInfo(opts.entryId) : undefined
  const journalId = single ? single.journalId : opts.journalId
  // An entry that isn't there exports nothing at all, not the whole library.
  const journals = opts.entryId && !single ? [] : repo.journals(journalId)
  const entryMedia = repo.media(journalId, single?.id)

  // Every photo and attachment, with its file and its folder in the archive.
  const media = [
    ...[...entryMedia.photos.values()].flat().map((p) => ({
      id: p.id,
      kind: 'photo' as const,
      entryId: p.entryId!,
      rel: p.originalPath,
      folder: 'photos',
    })),
    ...[...entryMedia.attachments.values()].flat().map((a) => ({
      id: a.id,
      kind: a.kind,
      entryId: a.entryId!,
      rel: a.path,
      folder: ATTACHMENT_LISTS.find((l) => l.kind === a.kind)!.folder,
    })),
  ]
  const hashed = await hashMediaFiles(opts.dataDir, userId, media)
  const files = new Map<string, MediaFile>() // photo or attachment row id -> file
  const missing: Missing[] = []
  for (const m of media) {
    const f = hashed.get(m.rel)
    if (f) files.set(m.id, f)
    else missing.push({ id: m.id, kind: m.kind, entryId: m.entryId, path: m.rel })
  }

  // Day One imports every .json file anywhere in the archive as a journal (a manifest.json hung
  // it, even inside a folder), so nothing but journals may end in .json.
  const names = journalFileNames(journals)
  const zip = new yazl.ZipFile()
  // @types/yazl declares outputStream as the bare web ReadableStream; at runtime it is a Node Readable.
  const output = zip.outputStream as unknown as Readable
  const mtime = new Date(now)
  let aborted = false

  /**
   * A journal's file, written as the zip reads it: the same text as `JSON.stringify(file, null, 2)`,
   * but the entries are read and stringified a batch at a time, so the whole journal is never in
   * memory at once.
   */
  function* journalFile(journal: (typeof journals)[number]): Generator<Buffer> {
    const shell = JSON.stringify(journalShell(journal), null, 2)
    const at = shell.indexOf(EMPTY_ENTRIES)
    yield Buffer.from(`${shell.slice(0, at)}"entries": [`)
    const ids = repo.entryIds(journal.id, single?.id)
    let first = true
    for (let i = 0; i < ids.length && !aborted; i += EXPORT_BATCH) {
      // One chunk per batch: a write per entry makes the zip's deflate several times slower.
      let chunk = ''
      for (const x of repo.entries(ids.slice(i, i + EXPORT_BATCH), entryMedia)) {
        // Nested two levels deep; JSON.stringify escapes newlines in strings, so every line is markup.
        const json = JSON.stringify(entryJson(x, files), null, 2).replace(/^/gm, '    ')
        chunk += `${first ? '' : ','}\n${json}`
        first = false
      }
      yield Buffer.from(chunk)
    }
    yield Buffer.from(`${first ? '' : '\n  '}]${shell.slice(at + EMPTY_ENTRIES.length)}`)
  }

  journals.forEach((j, i) => {
    const stream = Readable.from(journalFile(j))
    stream.on('error', (e) => output.destroy(e))
    zip.addReadStream(stream, names[i]!, { mtime })
  })

  if (opts.media) {
    const added = new Set<string>()
    for (const f of hashed.values()) {
      if (added.has(f.path)) continue
      added.add(f.path)
      // Opened only when the zip reaches it, so a big library doesn't hold every file open.
      const lazy = Readable.from(
        (async function* () {
          if (aborted) return
          yield* createReadStream(f.abs)
        })(),
      )
      lazy.on('error', (e) => output.destroy(e))
      // Photos and video are already compressed.
      zip.addReadStream(lazy, f.path, { mtime, compress: false })
    }
  }
  zip.end()
  output.on('close', () => {
    aborted = true // the client went away: stop reading files nobody will receive
  })

  const day = new Date(now).toISOString().slice(0, 10)
  // ASCII only, since this goes in a header; a name with nothing usable (all emoji) is left out.
  const slug = opts.journalId && journals[0] ? slugify(journals[0].name, 40) : ''
  if (single) {
    // Named for the entry's own day and first line, since a bare date says little.
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: single.timezone }).format(
      single.createdAt,
    )
    const title = slugify(entryTitle(single.bodyMd), 40)
    return {
      missing,
      filename: `cairn-entry-${date}${title ? `-${title}` : ''}.zip`,
      stream: output,
    }
  }
  return {
    missing,
    filename: `cairn-export${slug ? `-${slug}` : ''}-${day}${opts.media ? '' : '-json'}.zip`,
    stream: output,
  }
}
