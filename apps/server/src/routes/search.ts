import { Hono } from 'hono'
import { SearchMatchesQuerySchema, SearchQuerySchema, type SearchMatches } from '@cairn/shared'
import type { AuthEnv } from '../auth/middleware.ts'
import type { Db } from '../db/index.ts'
import { badRequest, reposFor } from './util.ts'

export function searchRoutes(db: Db) {
  const r = new Hono<AuthEnv>()

  r.get('/', (c) => {
    const query = SearchQuerySchema.safeParse(c.req.query())
    if (!query.success) return badRequest(c)
    try {
      return c.json(reposFor(db, c).search.search(query.data))
    } catch {
      return badRequest(c) // malformed cursor
    }
  })

  // Which words of one entry a search matched, so the reader can highlight them.
  r.get('/matches', (c) => {
    const query = SearchMatchesQuerySchema.safeParse(c.req.query())
    if (!query.success) return badRequest(c)
    const words = reposFor(db, c).search.matchedWords(query.data.entryId, query.data.q)
    return c.json<SearchMatches>({ words })
  })

  return r
}
