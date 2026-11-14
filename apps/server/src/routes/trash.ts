import { Hono, type Context } from 'hono'
import type {
  TrashCount,
  TrashEntriesPage,
  TrashEntryDetail,
  TrashPurged,
  TrashRestoredEntry,
} from '@cairn/shared'
import type { AuthEnv } from '../auth/middleware.ts'
import type { Db } from '../db/index.ts'
import { JournalArchivedError } from '../repo/entries.ts'
import { JournalDeletedError } from '../repo/trash.ts'
import { toDetail } from './entries.ts'
import { toJournal } from './journals.ts'
import { notFound, reposFor } from './util.ts'

const PAGE = 50

/**
 * The caller's trash: deleted entries and journals, kept for the server's retention. Restore
 * brings one back; DELETE purges it (or, at the root, everything) for good. Another user's id is
 * always a 404, like everywhere else.
 */
export function trashRoutes(db: Db) {
  const r = new Hono<AuthEnv>()

  const failed = (c: Context, e: unknown) => {
    if (e instanceof JournalDeletedError) return c.json({ error: 'journal_deleted' }, 409)
    if (e instanceof JournalArchivedError) return c.json({ error: 'journal_archived' }, 409)
    throw e
  }

  r.get('/entries', (c) => {
    const limit = Math.min(Math.max(Number(c.req.query('limit')) || PAGE, 1), 200)
    const cursor = c.req.query('cursor') || undefined
    return c.json<TrashEntriesPage>(reposFor(db, c).trash.entries({ cursor, limit }))
  })
  r.get('/entries/:id', (c) => {
    const d = reposFor(db, c).trash.entryDetail(c.req.param('id'))
    if (!d) return notFound(c)
    return c.json<TrashEntryDetail>({ ...toDetail(d), deletedAt: d.deletedAt, purgeAt: d.purgeAt })
  })
  r.get('/journals', (c) => c.json({ journals: reposFor(db, c).trash.journals() }))
  r.get('/count', (c) => c.json<TrashCount>(reposFor(db, c).trash.count()))

  r.post('/entries/:id/restore', (c) => {
    try {
      const e = reposFor(db, c).trash.restoreEntry(c.req.param('id'))
      return e ? c.json<TrashRestoredEntry>({ id: e.id, journalId: e.journalId }) : notFound(c)
    } catch (e) {
      return failed(c, e)
    }
  })
  r.post('/journals/:id/restore', (c) => {
    const repos = reposFor(db, c)
    const j = repos.trash.restoreJournal(c.req.param('id'))
    return j ? c.json(toJournal(j, repos.journals.entryCounts().get(j.id) ?? 0)) : notFound(c)
  })

  r.delete('/entries/:id', (c) =>
    reposFor(db, c).trash.purgeEntry(c.req.param('id')) ? c.body(null, 204) : notFound(c),
  )
  r.delete('/journals/:id', (c) => {
    const p = reposFor(db, c).trash.purgeJournal(c.req.param('id'))
    return p ? c.json<TrashPurged>(p) : notFound(c)
  })
  r.delete('/', (c) => c.json<TrashPurged>(reposFor(db, c).trash.empty()))

  return r
}
