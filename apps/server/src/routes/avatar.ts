import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { AVATAR_MAX_BYTES } from '@cairn/shared'
import type { AuthEnv } from '../auth/middleware.ts'
import type { Db } from '../db/index.ts'
import { avatarPath, removeAvatar, renderAvatar, writeAvatar } from '../photos/avatar.ts'
import { UnsupportedImageError } from '../photos/upload.ts'
import { findUserById, setAvatarUpdatedAt } from '../repo/users.ts'
import { toMe } from '../auth/routes.ts'
import { notFound } from './util.ts'

const tooLarge = { error: 'too_large', message: 'That picture is over 10 MB.' }

/**
 * The account's profile picture. There is no id in any path: every route acts on the session's own
 * user, so one user can't name another's. The web app asks for `?v=<avatarUpdatedAt>`, which the
 * server ignores, so a replaced picture gets a new URL and the old one can be cached for good.
 */
export function avatarRoutes(db: Db, dataDir: string) {
  const root = resolve(dataDir)
  const r = new Hono<AuthEnv>()
  const me = (userId: string) => {
    const user = findUserById(db, userId)
    return user ? toMe(db, user) : null
  }

  r.get('/', (c) => {
    const userId = c.get('userId')
    if (findUserById(db, userId)?.avatarUpdatedAt == null) return notFound(c)
    let bytes: Buffer
    try {
      bytes = readFileSync(join(root, avatarPath(userId)))
    } catch {
      return notFound(c)
    }
    return c.body(new Uint8Array(bytes), 200, {
      'Content-Type': 'image/webp',
      'Cache-Control': 'private, max-age=31536000, immutable',
    })
  })

  r.put(
    '/',
    bodyLimit({ maxSize: AVATAR_MAX_BYTES, onError: (c) => c.json(tooLarge, 413) }),
    async (c) => {
      const userId = c.get('userId')
      const bytes = Buffer.from(await c.req.arrayBuffer())
      if (bytes.length === 0) return c.json({ error: 'invalid_request' }, 400)
      try {
        writeAvatar(root, userId, await renderAvatar(bytes))
      } catch (e) {
        if (e instanceof UnsupportedImageError)
          return c.json({ error: 'unsupported_image', message: e.message }, 415)
        throw e
      }
      // Strictly newer than the last one, so a replacement within the same millisecond still
      // changes the URL.
      const prev = findUserById(db, userId)?.avatarUpdatedAt ?? 0
      setAvatarUpdatedAt(db, userId, Math.max(Date.now(), prev + 1))
      return c.json(me(userId))
    },
  )

  r.delete('/', (c) => {
    const userId = c.get('userId')
    removeAvatar(root, userId)
    setAvatarUpdatedAt(db, userId, null)
    return c.json(me(userId))
  })

  return r
}
