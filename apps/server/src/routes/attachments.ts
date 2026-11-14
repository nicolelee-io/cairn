import { createReadStream, statSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { Hono } from 'hono'
import { AttachmentLimitSchema, type AttachmentLimit } from '@cairn/shared'
import type { AuthEnv } from '../auth/middleware.ts'
import type { Db } from '../db/index.ts'
import { FileTooLargeError, ingestAttachment, UnsupportedFileError } from '../attachments/upload.ts'
import { attachmentLimit } from '../attachments/limit.ts'
import { toAttachment } from './entries.ts'
import { badRequest, notFound, parseBody, reposFor } from './util.ts'

/**
 * Non-photo files. Upload is the raw request body (`PUT /?name=`), streamed to disk, so a large
 * video never sits in memory the way a multipart parse would hold it. Served only here, after an
 * ownership check, with Range support (Safari won't play a video without it).
 */
export function attachmentRoutes(db: Db, dataDir: string) {
  const root = resolve(dataDir)
  const limit = attachmentLimit(db)
  const r = new Hono<AuthEnv>()

  const tooLarge = (mb: number) =>
    ({ error: 'too_large', message: `That file is over ${mb} MB.` }) as const

  r.get('/limit', (c) => c.json<AttachmentLimit>({ maxMb: limit.mb() }))
  r.put('/limit', async (c) => {
    const body = await parseBody(c, AttachmentLimitSchema)
    if (!body) return badRequest(c)
    limit.set(body.maxMb)
    return c.json<AttachmentLimit>({ maxMb: limit.mb() })
  })

  r.put('/', async (c) => {
    const mb = limit.mb()
    const maxBytes = mb * 1024 * 1024
    const declared = Number(c.req.header('content-length'))
    if (declared > maxBytes) return c.json(tooLarge(mb), 413)
    const body = c.req.raw.body
    if (!body) return badRequest(c)
    try {
      const input = await ingestAttachment(root, c.get('userId'), body, {
        filename: c.req.query('name'),
        maxBytes,
      })
      return c.json(toAttachment(reposFor(db, c).attachments.add(input)), 201)
    } catch (e) {
      if (e instanceof FileTooLargeError) return c.json(tooLarge(mb), 413)
      if (e instanceof UnsupportedFileError)
        return c.json({ error: 'unsupported_file', message: e.message }, 415)
      throw e
    }
  })

  r.delete('/:id', (c) =>
    reposFor(db, c).attachments.remove(c.req.param('id')) ? c.body(null, 204) : notFound(c),
  )

  r.get('/:id', (c) => {
    const a = reposFor(db, c).attachments.get(c.req.param('id'))
    if (!a) return notFound(c)
    // Belt and braces: the stored path must be inside this user's attachment folder.
    const file = resolve(root, a.path)
    if (!file.startsWith(`${resolve(root, 'attachments', c.get('userId'))}${sep}`))
      return notFound(c)

    const etag = `"${a.sha256}"`
    const disposition = c.req.query('download') !== undefined ? 'attachment' : 'inline'
    const headers: Record<string, string> = {
      'Content-Type': a.mime,
      'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(a.filename)}`,
      ETag: etag,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    }
    if (c.req.header('if-none-match') === etag) return new Response(null, { status: 304, headers })

    let size: number
    try {
      size = statSync(file).size
    } catch {
      return notFound(c)
    }
    const range = parseRange(c.req.header('range'), size)
    if (range === 'invalid')
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    const [start, end] = range ?? [0, size - 1]
    const stream = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream
    return new Response(size ? stream : null, {
      status: range ? 206 : 200,
      headers: {
        ...headers,
        'Content-Length': String(size ? end - start + 1 : 0),
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
      },
    })
  })

  return r
}

/**
 * One `bytes=` range, as browsers send for media (`a-b`, `a-`, or the last `-n` bytes). Null when
 * there is no usable Range header (serve it all); 'invalid' when it can't be satisfied.
 */
export function parseRange(
  header: string | undefined,
  size: number,
): [number, number] | null | 'invalid' {
  const m = header?.match(/^bytes=(\d*)-(\d*)$/)
  if (!m || (!m[1] && !m[2])) return null
  let start: number
  let end: number
  if (!m[1]) {
    start = Math.max(0, size - Number(m[2]))
    end = size - 1
  } else {
    start = Number(m[1])
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
  }
  return start > end || start >= size ? 'invalid' : [start, end]
}
