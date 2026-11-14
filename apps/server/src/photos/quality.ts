import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Metadata } from 'sharp'
import { PhotoQualitySchema, type PhotoQuality } from '@cairn/shared'
import type { Db } from '../db/index.ts'
import { photos } from '../db/schema.ts'
import { appSettingsRepo } from '../repo/appSettings.ts'
import { compressImage } from './pipeline.ts'
import { photoPath, storeOnce, touch } from './storage.ts'

const KEY = 'photo_quality'

/**
 * The server's photo quality setting (admins set it in Settings). When it was never set it is
 * decided once and saved: `original` on a server that already holds photos (nothing changes
 * under an upgrade), `compressed` on a new one. The server pins it at startup.
 */
export function photoQuality(db: Db) {
  const store = appSettingsRepo(db)
  return {
    get(): PhotoQuality {
      const saved = PhotoQualitySchema.safeParse(store.get(KEY))
      if (saved.success) return saved.data
      const hasPhotos = db.select({ id: photos.id }).from(photos).limit(1).get() !== undefined
      const chosen = hasPhotos ? 'original' : 'compressed'
      store.set(KEY, chosen)
      return chosen
    },
    set: (quality: PhotoQuality) => store.set(KEY, quality),
  }
}

export const compressedPath = (userId: string, sha256: string) =>
  photoPath(userId, 'compressed', sha256, 'jpg')

export interface StoredOriginal {
  originalPath: string
  mime: string
  /** Size of the stored file. */
  bytes: number
}

/**
 * Stores the "original" of an upload or import as the setting says: the bytes as they came, or
 * their compressed JPEG at `photos/<user>/compressed/<sha256 of the upload>.jpg` (so the same
 * upload again lands on the same file, and `sha256` stays the upload's). Anything that can't be
 * compressed (WebP, transparency, not smaller, unreadable) keeps its bytes.
 */
export async function storeOriginal(
  dataDir: string,
  userId: string,
  upload: { bytes: Buffer; sha256: string; ext: string; mime: string; meta?: Metadata },
  quality: PhotoQuality,
): Promise<StoredOriginal> {
  if (quality === 'compressed') {
    const rel = compressedPath(userId, upload.sha256)
    const file = join(dataDir, rel)
    if (existsSync(file)) {
      touch(file) // see storeOnce
      return { originalPath: rel, mime: 'image/jpeg', bytes: statSync(file).size }
    }
    const small = await compressImage(upload.bytes, upload.meta).catch(() => null)
    if (small) {
      storeOnce(dataDir, rel, small)
      return { originalPath: rel, mime: 'image/jpeg', bytes: small.length }
    }
  }
  const rel = photoPath(userId, 'originals', upload.sha256, upload.ext)
  storeOnce(dataDir, rel, upload.bytes)
  return { originalPath: rel, mime: upload.mime, bytes: upload.bytes.length }
}
