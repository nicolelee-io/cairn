import { createHash } from 'node:crypto'
import { uuidv7, type PhotoQuality } from '@cairn/shared'
import type { UploadedPhoto } from '../repo/photos.ts'
import { openImage, processImage } from './pipeline.ts'
import { storeOriginal } from './quality.ts'
import { photoPath, storeOnce } from './storage.ts'

const FORMATS = {
  jpeg: { ext: 'jpg', mime: 'image/jpeg' },
  png: { ext: 'png', mime: 'image/png' },
  webp: { ext: 'webp', mime: 'image/webp' },
  gif: { ext: 'gif', mime: 'image/gif' },
  tiff: { ext: 'tif', mime: 'image/tiff' },
  avif: { ext: 'avif', mime: 'image/avif' },
} as const

/** sharp calls AVIF "heif" (compression av1); HEIC is "heif" with hevc, which it can't decode. */
const formatOf = (meta: { format?: string; compression?: string }) =>
  meta.format === 'heif' && meta.compression === 'av1' ? 'avif' : meta.format

export class UnsupportedImageError extends Error {}

/**
 * Validates an uploaded file by what it actually is (not its name or declared type), stores the
 * original (as uploaded, or compressed, per `quality`) plus the display and thumb derivatives,
 * and returns the row to record. Identical bytes from the same user share their files
 * (content-addressed by the upload's sha256).
 */
export async function ingestUpload(
  dataDir: string,
  userId: string,
  bytes: Buffer,
  quality: PhotoQuality,
  now = Date.now(),
): Promise<UploadedPhoto> {
  let meta
  try {
    meta = await openImage(bytes).metadata()
  } catch {
    throw new UnsupportedImageError('That file is not an image Cairn can read.')
  }
  const format = formatOf(meta)
  const kind = format && format in FORMATS ? FORMATS[format as keyof typeof FORMATS] : null
  if (!kind) {
    throw new UnsupportedImageError(
      format === 'heif'
        ? 'HEIC/HEIF photos are not supported yet. Export as JPEG and try again.'
        : 'Only JPEG, PNG, WebP, GIF, AVIF and TIFF photos are supported.',
    )
  }

  let img
  try {
    img = await processImage(bytes, meta)
  } catch {
    throw new UnsupportedImageError(
      'That image is damaged or too large (over 100 megapixels) to process.',
    )
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const original = await storeOriginal(
    dataDir,
    userId,
    { bytes, sha256, ext: kind.ext, mime: kind.mime, meta },
    quality,
  )
  const displayPath = photoPath(userId, 'display', sha256, 'webp')
  const thumbPath = photoPath(userId, 'thumb', sha256, 'webp')
  storeOnce(dataDir, displayPath, img.display)
  storeOnce(dataDir, thumbPath, img.thumb)
  return {
    id: uuidv7(now),
    ...original,
    displayPath,
    thumbPath,
    width: img.width,
    height: img.height,
    sha256,
    takenAt: img.takenAt,
    latitude: img.latitude,
    longitude: img.longitude,
  }
}
