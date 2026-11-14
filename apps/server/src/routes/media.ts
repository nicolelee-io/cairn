import { Hono } from 'hono'
import { MEDIA_KINDS, type MediaKind } from '@cairn/shared'
import type { AuthEnv } from '../auth/middleware.ts'
import type { Db } from '../db/index.ts'
import { badRequest, reposFor } from './util.ts'

const MAX_PAGE = 100

/** `GET /api/media?journalId&kinds=photo,video&cursor&limit`: the Media view's feed, newest entry first. */
export function mediaRoutes(db: Db) {
  const r = new Hono<AuthEnv>()

  r.get('/', (c) => {
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 40) || 40, 1), MAX_PAGE)
    const asked = c.req.query('kinds')
    const kinds = asked ? asked.split(',') : undefined
    if (kinds?.some((k) => !MEDIA_KINDS.includes(k as MediaKind))) return badRequest(c)
    try {
      return c.json(
        reposFor(db, c).gallery.page({
          journalId: c.req.query('journalId') || undefined,
          kinds: kinds as MediaKind[] | undefined,
          cursor: c.req.query('cursor') || undefined,
          limit,
        }),
      )
    } catch {
      return badRequest(c) // malformed cursor
    }
  })

  return r
}
