import { Hono } from 'hono'
import { CreateTemplateSchema, UpdateTemplateSchema, type Template } from '@cairn/shared'
import type { AuthEnv } from '../auth/middleware.ts'
import type { Db } from '../db/index.ts'
import type { templates } from '../db/schema.ts'
import { TemplateLimitError } from '../repo/templates.ts'
import { badRequest, notFound, parseBody, reposFor } from './util.ts'

// Explicit field list: no user id in a response.
const toTemplate = (t: typeof templates.$inferSelect): Template => ({
  id: t.id,
  name: t.name,
  bodyMd: t.bodyMd,
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
})

/** The caller's own entry templates; there is no server-wide list and no id reaches another user's. */
export function templateRoutes(db: Db) {
  const r = new Hono<AuthEnv>()

  r.get('/', (c) => c.json({ templates: reposFor(db, c).templates.list().map(toTemplate) }))

  r.post('/', async (c) => {
    const body = await parseBody(c, CreateTemplateSchema)
    if (!body) return badRequest(c)
    try {
      return c.json(toTemplate(reposFor(db, c).templates.create(body)), 201)
    } catch (e) {
      if (e instanceof TemplateLimitError) return c.json({ error: 'limit_reached' }, 409)
      throw e
    }
  })

  r.patch('/:id', async (c) => {
    const body = await parseBody(c, UpdateTemplateSchema)
    if (!body) return badRequest(c)
    const row = reposFor(db, c).templates.update(c.req.param('id'), body)
    return row ? c.json(toTemplate(row)) : notFound(c)
  })

  r.delete('/:id', (c) =>
    reposFor(db, c).templates.remove(c.req.param('id')) ? c.body(null, 204) : notFound(c),
  )

  return r
}
