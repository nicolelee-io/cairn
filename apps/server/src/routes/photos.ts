import { createReadStream, statSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { PHOTO_VARIANTS, type PhotoVariant } from '@cairn/shared'
import type { AuthEnv } from '../auth/middleware.ts'
import type { Db } from '../db/index.ts'
import { photoQuality } from '../photos/quality.ts'
import { ingestUpload, UnsupportedImageError } from '../photos/upload.ts'
import { notFound, reposFor } from './util.ts'

/** One file per request, under Cloudflare's 100MB request limit (SPEC 7). */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

/**
 * Photos are served only here, after an ownership check (the repo filters by the session's user),
 * never from a public static directory. Files are content-addressed, so they can be cached hard.
 */
export function photoRoutes(db: Db, dataDir: string) {
  const root = resolve(dataDir)
  const quality = photoQuality(db)
  const r = new Hono<AuthEnv>()

  r.post(
    '/',
    bodyLimit({
      maxSize: MAX_UPLOAD_BYTES + 1024 * 1024, // multipart framing
      onError: (c) => c.json({ error: 'too_large', message: 'That photo is over 50 MB.' }, 413),
    }),
    async (c) => {
      const form = await c.req.parseBody().catch(() => null)
      const file = form?.file
      if (!(file instanceof File)) return c.json({ error: 'invalid_request' }, 400)
      if (file.size > MAX_UPLOAD_BYTES)
        return c.json({ error: 'too_large', message: 'That photo is over 50 MB.' }, 413)
      try {
        const input = await ingestUpload(
          root,
          c.get('userId'),
          Buffer.from(await file.arrayBuffer()),
          quality.get(),
        )
        const photo = reposFor(db, c).photos.add(input)
        return c.json(
          {
            id: photo.id,
            position: photo.position,
            width: photo.width,
            height: photo.height,
            takenAt: photo.takenAt,
            latitude: photo.latitude,
            longitude: photo.longitude,
          },
          201,
        )
      } catch (e) {
        if (e instanceof UnsupportedImageError)
          return c.json({ error: 'unsupported_image', message: e.message }, 415)
        throw e
      }
    },
  )

  r.delete('/:id', (c) =>
    reposFor(db, c).photos.remove(c.req.param('id')) ? c.body(null, 204) : notFound(c),
  )

  r.get('/:id/:variant', (c) => {
    const variant = c.req.param('variant') as PhotoVariant
    if (!PHOTO_VARIANTS.includes(variant)) return notFound(c)
    const photo = reposFor(db, c).photos.get(c.req.param('id'))
    if (!photo) return notFound(c)

    // Derivatives are always WebP. If one wasn't made (undecodable file), fall back to the original.
    const derived =
      variant === 'display' ? photo.displayPath : variant === 'thumb' ? photo.thumbPath : null
    const rel = derived ?? photo.originalPath
    const mime = derived ? 'image/webp' : photo.mime

    // Belt and braces: the stored path must be inside this user's photo folder.
    const file = resolve(root, rel)
    if (!file.startsWith(`${resolve(root, 'photos', c.get('userId'))}${sep}`)) return notFound(c)

    // A compressed original is a different file under the same sha256 (the upload's).
    const etag = `"${photo.sha256}-${derived ? variant : rel.includes('/compressed/') ? 'compressed' : 'original'}"`
    // ?download saves the file instead of showing it (the lightbox's link; an installed PWA ignores
    // target="_blank", so a plain link would replace the app's window).
    const headers = {
      'Content-Type': mime,
      ...(c.req.query('download') !== undefined && { 'Content-Disposition': 'attachment' }),
      ETag: etag,
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
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
      headers: { ...headers, 'Content-Length': String(size) },
    })
  })

  return r
}
