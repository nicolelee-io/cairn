import sharp, { type Metadata } from 'sharp'
import exifReader from 'exif-reader'
import { COMPRESSED_EDGE } from '@cairn/shared'

// Cairn often shares a small home server with other services: no libvips operation cache, and
// few threads, to keep memory low.
sharp.cache(false)
sharp.concurrency(2)

/** ~100 MP covers any phone camera; sharp's default (268 MP) could decode to ~1 GB, too much for a small server. */
export const MAX_PIXELS = 100_000_000
export const openImage = (bytes: Buffer) => sharp(bytes, { limitInputPixels: MAX_PIXELS })

export const DISPLAY_EDGE = 2048
export const THUMB_EDGE = 400

export interface ProcessedImage {
  /** Size after applying the EXIF orientation, i.e. as displayed. */
  width: number
  height: number
  /** UTC ms from EXIF DateTimeOriginal; null unless the file records its UTC offset. */
  takenAt: number | null
  latitude: number | null
  longitude: number | null
  display: Buffer
  thumb: Buffer
}

/**
 * Makes the display (~2048px) and thumb (~400px) derivatives and reads EXIF date and GPS from the
 * original. Derivatives are auto-rotated WebP and carry no metadata, so no GPS leaks through them
 * (SPEC 7); the database holds the coordinates deliberately. The original is never modified.
 * Throws if the bytes aren't an image sharp can decode.
 */
export async function processImage(
  original: Buffer,
  /** Metadata the caller already read from these bytes, to skip decoding the header again. */
  known?: Metadata,
): Promise<ProcessedImage> {
  const meta = known ?? (await openImage(original).metadata())
  if (!meta.width || !meta.height) throw new Error('image has no dimensions')
  const swapped = (meta.orientation ?? 1) >= 5 // 90/270 degree EXIF rotations
  const exif = readExif(meta.exif)

  // .rotate() with no argument applies the EXIF orientation; sharp drops metadata by default.
  const resized = (edge: number, quality: number) =>
    openImage(original)
      .rotate()
      .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
      .webp({ quality })
      .toBuffer()

  const [display, thumb] = await Promise.all([resized(DISPLAY_EDGE, 82), resized(THUMB_EDGE, 75)])
  return {
    width: swapped ? meta.height : meta.width,
    height: swapped ? meta.width : meta.height,
    ...exif,
    display,
    thumb,
  }
}

/** A compressed copy is kept only when it is at most this share of the original's size. */
export const KEEP_IF_UNDER = 0.9

/**
 * The compressed form of an original (the `compressed` photo quality): a JPEG of at most
 * COMPRESSED_EDGE px on the long edge, quality 85, with the EXIF (orientation, date, GPS) and
 * colour profile kept, so it looks and sorts like the original. Only for JPEGs and opaque PNGs
 * (WebP is already compact; transparency would turn black). Null when it isn't one of those or
 * the result isn't clearly smaller, so the caller keeps the original.
 */
export async function compressImage(original: Buffer, known?: Metadata): Promise<Buffer | null> {
  const meta = known ?? (await openImage(original).metadata())
  if (meta.format !== 'jpeg' && meta.format !== 'png') return null
  if (meta.format === 'png' && meta.hasAlpha) {
    const { isOpaque } = await openImage(original).stats()
    if (!isOpaque) return null
  }
  const out = await openImage(original)
    .resize({
      width: COMPRESSED_EDGE,
      height: COMPRESSED_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .keepMetadata()
    .jpeg({ quality: 85 })
    .toBuffer()
  return out.length <= original.length * KEEP_IF_UNDER ? out : null
}

function readExif(
  buf: Buffer | undefined,
): Pick<ProcessedImage, 'takenAt' | 'latitude' | 'longitude'> {
  const none = { takenAt: null, latitude: null, longitude: null }
  if (!buf) return none
  try {
    const x = exifReader(buf)
    // exif-reader parses the wall-clock time as if it were UTC, so subtract the recorded offset.
    const wall = x.Photo?.DateTimeOriginal
    const offset = parseOffset(x.Photo?.OffsetTimeOriginal ?? x.Photo?.OffsetTime)
    const gps = x.GPSInfo
    return {
      takenAt: wall instanceof Date && offset !== null ? wall.getTime() - offset * 60_000 : null,
      latitude: coordinate(gps?.GPSLatitude, gps?.GPSLatitudeRef, 'S'),
      longitude: coordinate(gps?.GPSLongitude, gps?.GPSLongitudeRef, 'W'),
    }
  } catch {
    return none // corrupt EXIF shouldn't cost us the photo
  }
}

/** "+02:00" -> 120 (minutes east of UTC). */
function parseOffset(s: unknown): number | null {
  const m = typeof s === 'string' ? /^([+-])(\d{2}):(\d{2})$/.exec(s.trim()) : null
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : null
}

function coordinate(dms: unknown, ref: unknown, negativeRef: string): number | null {
  if (!Array.isArray(dms) || dms.length !== 3 || dms.some((n) => typeof n !== 'number')) return null
  const [d, m, s] = dms as number[]
  const v = d! + m! / 60 + s! / 3600
  if (!Number.isFinite(v)) return null
  return ref === negativeRef ? -v : v
}
