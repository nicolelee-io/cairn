import { randomUUID } from 'node:crypto'
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { openImage } from './pipeline.ts'
import { UnsupportedImageError } from './upload.ts'

export const AVATAR_SIZE = 256

/** Data-dir-relative, under the user's photo folder so backups cover it. Never in the DB: the user row holds only the version. */
export const avatarPath = (userId: string) => `photos/${userId}/avatar.webp`

/**
 * Square, 256px, WebP, EXIF orientation applied and all metadata dropped (sharp strips it unless
 * asked to keep it). Throws UnsupportedImageError for anything but JPEG, PNG or WebP.
 */
export async function renderAvatar(bytes: Buffer): Promise<Buffer> {
  try {
    const meta = await openImage(bytes).metadata()
    if (meta.format !== 'jpeg' && meta.format !== 'png' && meta.format !== 'webp')
      throw new UnsupportedImageError('Use a JPEG, PNG or WebP picture.')
    return await openImage(bytes)
      .rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'centre' })
      .webp({ quality: 85 })
      .toBuffer()
  } catch (e) {
    if (e instanceof UnsupportedImageError) throw e
    throw new UnsupportedImageError('That file could not be read as a picture.')
  }
}

/**
 * Stores only this derivative, not the upload: the keep-the-original rule is for entry photos, and
 * a profile picture is small, replaceable and not part of the journal. Replaces any earlier one.
 */
export function writeAvatar(dataDir: string, userId: string, webp: Buffer) {
  const path = join(dataDir, avatarPath(userId))
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(tmp, webp)
    renameSync(tmp, path)
  } catch (e) {
    rmSync(tmp, { force: true })
    throw e
  }
}

export function removeAvatar(dataDir: string, userId: string) {
  rmSync(join(dataDir, avatarPath(userId)), { force: true })
}
