import { Hono } from 'hono'
import {
  CreateJournalSchema,
  ReorderJournalsSchema,
  UpdateJournalSchema,
  type Journal,
} from '@cairn/shared'
import type { AuthEnv } from '../auth/middleware.ts'
import type { Db } from '../db/index.ts'
import type { journals } from '../db/schema.ts'
import { IdTakenError } from '../repo/entries.ts'
import { badRequest, notFound, parseBody, reposFor } from './util.ts'

export const toJournal = (j: typeof journals.$inferSelect, entryCount: number): Journal => ({
  id: j.id,
  name: j.name,
  color: j.color,
  icon: j.icon,
  description: j.description,
  archivedAt: j.archivedAt,
  sortOrder: j.sortOrder,
  createdAt: j.createdAt,
  rev: j.rev,
  entryCount,
})

export function journalRoutes(db: Db) {
  const r = new Hono<AuthEnv>()

  // Archived journals are listed too (the UI folds them into a collapsed section); `archivedAt`
  // tells them apart.
  r.get('/', (c) => {
    const { journals } = reposFor(db, c)
    const counts = journals.entryCounts()
    return c.json(
      journals.list({ includeArchived: true }).map((j) => toJournal(j, counts.get(j.id) ?? 0)),
    )
  })

  r.post('/', async (c) => {
    const body = await parseBody(c, CreateJournalSchema)
    if (!body) return badRequest(c)
    const { journals } = reposFor(db, c)
    try {
      // Replaying a create with the same client id returns the existing journal.
      const replay = body.id ? journals.get(body.id) : undefined
      if (replay) return c.json(toJournal(replay, journals.entryCounts().get(replay.id) ?? 0))
      return c.json(toJournal(journals.create(body), 0), 201)
    } catch (e) {
      if (e instanceof IdTakenError) return c.json({ error: 'id_taken' }, 409)
      throw e
    }
  })

  // Registered as PUT so it can't be mistaken for PATCH /:id.
  r.put('/order', async (c) => {
    const body = await parseBody(c, ReorderJournalsSchema)
    if (!body) return badRequest(c)
    const { journals } = reposFor(db, c)
    journals.reorder(body.ids)
    const counts = journals.entryCounts()
    return c.json(
      journals.list({ includeArchived: true }).map((j) => toJournal(j, counts.get(j.id) ?? 0)),
    )
  })

  r.patch('/:id', async (c) => {
    const body = await parseBody(c, UpdateJournalSchema)
    if (!body) return badRequest(c)
    const { journals } = reposFor(db, c)
    const j = journals.update(c.req.param('id'), body)
    return j ? c.json(toJournal(j, journals.entryCounts().get(j.id) ?? 0)) : notFound(c)
  })

  // Destructive: also deletes the journal's entries. The UI confirms; archiving is the soft option.
  r.delete('/:id', (c) =>
    reposFor(db, c).journals.softDelete(c.req.param('id')) ? c.body(null, 204) : notFound(c),
  )

  return r
}
