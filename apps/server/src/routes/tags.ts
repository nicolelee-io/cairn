import { Hono, type Context } from 'hono'
import { MergeTagsSchema, RenameTagSchema, TagNameSchema } from '@cairn/shared'
import type { AuthEnv } from '../auth/middleware.ts'
import type { Db } from '../db/index.ts'
import { TagExistsError, TagNotFoundError } from '../repo/tags.ts'
import { badRequest, notFound, parseBody, reposFor } from './util.ts'

export function tagRoutes(db: Db) {
  const r = new Hono<AuthEnv>()

  const failed = (c: Context, e: unknown) => {
    if (e instanceof TagNotFoundError) return notFound(c)
    if (e instanceof TagExistsError) return c.json({ error: 'tag_exists' }, 409)
    throw e
  }

  r.get('/', (c) => c.json({ tags: reposFor(db, c).tags.list() }))

  r.patch('/', async (c) => {
    const body = await parseBody(c, RenameTagSchema)
    if (!body) return badRequest(c)
    try {
      return c.json(reposFor(db, c).tags.rename(body.name, body.newName))
    } catch (e) {
      return failed(c, e)
    }
  })

  r.post('/merge', async (c) => {
    const body = await parseBody(c, MergeTagsSchema)
    if (!body) return badRequest(c)
    try {
      return c.json(reposFor(db, c).tags.merge(body.from, body.into))
    } catch (e) {
      return failed(c, e)
    }
  })

  // The tag's name rides in the query string: a body on DELETE isn't reliably passed along.
  r.delete('/', (c) => {
    const name = TagNameSchema.safeParse(c.req.query('name'))
    if (!name.success) return badRequest(c)
    try {
      return c.json(reposFor(db, c).tags.remove(name.data))
    } catch (e) {
      return failed(c, e)
    }
  })

  return r
}
