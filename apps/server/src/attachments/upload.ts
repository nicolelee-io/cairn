import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { uuidv7, type AttachmentKind } from '@cairn/shared'
import type { UploadedAttachment } from '../repo/attachments.ts'
import { touch } from '../photos/storage.ts'

export class UnsupportedFileError extends Error {}
export class FileTooLargeError extends Error {}

// ISO-BMFF brands that are still images (HEIC/HEIF/AVIF), not video.
const IMAGE_BRANDS = new Set([
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'mif1',
  'msf1',
  'avif',
  'avis',
])

/**
 * What a file really is, from its first bytes (never its name or declared type): the non-photo
 * types Day One accepts. MP4, MOV and M4A share one container, told apart by its `ftyp` brand.
 */
export function sniffAttachment(
  head: Buffer,
): { kind: AttachmentKind; mime: string; ext: string } | null {
  if (head.subarray(0, 5).toString('latin1') === '%PDF-')
    return { kind: 'pdf', mime: 'application/pdf', ext: 'pdf' }
  if (head.length >= 12 && head.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = head.subarray(8, 12).toString('latin1')
    if (IMAGE_BRANDS.has(brand)) return null
    if (brand === 'qt  ') return { kind: 'video', mime: 'video/quicktime', ext: 'mov' }
    if (brand === 'M4A ' || brand === 'M4B ')
      return { kind: 'audio', mime: 'audio/mp4', ext: 'm4a' }
    return { kind: 'video', mime: 'video/mp4', ext: 'mp4' }
  }
  return null
}

/** The uploaded name, fit for display and a Content-Disposition header. */
export function cleanFilename(name: string | undefined, ext: string): string {
  const base = (name ?? '')
    .split(/[/\\]/)
    .pop()!
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 200)
  return base || `attachment.${ext}`
}

/** Data-dir-relative path (what the DB stores). Content-addressed by sha256. */
export const attachmentPath = (userId: string, sha256: string, ext: string) =>
  `attachments/${userId}/${sha256}.${ext}`

/** What `spool` leaves behind: a temp file next to its destination, hashed and measured. */
interface Spooled {
  tmp: string
  sha256: string
  bytes: number
  /** The first 16 bytes, for `sniffAttachment`. */
  head: Buffer
}

/**
 * Writes a stream to a temp file in the user's attachment folder while hashing it, so a large
 * video never sits in memory. Throws FileTooLargeError past `maxBytes`; the temp file is the
 * caller's to place or remove (`place`).
 */
async function spool(
  dataDir: string,
  userId: string,
  source: Readable,
  maxBytes = Infinity,
): Promise<Spooled> {
  const dir = join(dataDir, 'attachments', userId)
  mkdirSync(dir, { recursive: true })
  const tmp = join(dir, `.upload-${randomUUID()}.tmp`)
  const hash = createHash('sha256')
  let bytes = 0
  let head = Buffer.alloc(0)
  const meter = new Transform({
    transform(chunk: Buffer, _enc, done) {
      bytes += chunk.length
      if (bytes > maxBytes) return done(new FileTooLargeError())
      if (head.length < 16) head = Buffer.concat([head, chunk.subarray(0, 16 - head.length)])
      hash.update(chunk)
      done(null, chunk)
    },
  })
  try {
    await pipeline(source, meter, createWriteStream(tmp))
  } catch (e) {
    rmSync(tmp, { force: true })
    throw e
  }
  return { tmp, sha256: hash.digest('hex'), bytes, head }
}

/** Moves a spooled file to `path`, or drops it (and freshens the copy) if those bytes are stored. */
function place(dataDir: string, tmp: string, path: string) {
  const dest = join(dataDir, path)
  if (existsSync(dest)) {
    rmSync(tmp)
    touch(dest)
  } else renameSync(tmp, dest)
}

/**
 * Streams an upload to a temp file while hashing it, so a 95 MB video never sits in memory, then
 * checks what it is and moves it into place (or drops it, if the same bytes are already stored).
 * Throws FileTooLargeError past `maxBytes` and UnsupportedFileError for anything else.
 */
export async function ingestAttachment(
  dataDir: string,
  userId: string,
  body: ReadableStream<Uint8Array>,
  opts: { filename?: string; maxBytes: number },
  now = Date.now(),
): Promise<UploadedAttachment> {
  const { tmp, sha256, bytes, head } = await spool(
    dataDir,
    userId,
    Readable.fromWeb(body as WebReadableStream<Uint8Array>),
    opts.maxBytes,
  )
  try {
    const type = sniffAttachment(head)
    if (!type) throw new UnsupportedFileError('Attachments can be PDF, MP4, MOV or M4A files.')
    const path = attachmentPath(userId, sha256, type.ext)
    place(dataDir, tmp, path)
    return {
      id: uuidv7(now),
      kind: type.kind,
      path,
      mime: type.mime,
      bytes,
      sha256,
      filename: cleanFilename(opts.filename, type.ext),
    }
  } finally {
    rmSync(tmp, { force: true })
  }
}

/**
 * Stores an attachment read from a stream (the importer), the same way as an upload but with no
 * size cap. The bytes decide the type when they can; otherwise the caller's declared kind and
 * extension are kept, so an odd file still survives the import (`sniffed: false` lets the caller
 * warn).
 */
export async function storeAttachmentStream(
  dataDir: string,
  userId: string,
  source: Readable,
  declared: { kind: AttachmentKind; ext: string; mime: string },
) {
  const { tmp, sha256, bytes, head } = await spool(dataDir, userId, source)
  try {
    const found = sniffAttachment(head)
    const type = found ?? declared
    const path = attachmentPath(userId, sha256, type.ext)
    place(dataDir, tmp, path)
    return { ...type, path, sha256, bytes, sniffed: !!found }
  } finally {
    rmSync(tmp, { force: true })
  }
}
