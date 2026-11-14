import { Readable } from 'node:stream'
import { Hono, type Context } from 'hono'
import type { AuthEnv } from '../auth/middleware.ts'
import type { Db } from '../db/index.ts'
import { buildExport } from '../export/run.ts'
import { createRepos } from '../repo/index.ts'
import { notFound, reposFor } from './util.ts'

/**
 * Download of the signed-in user's own data (never anyone else's: the export reads through the
 * repo layer). `?journalId=` exports one journal; `?media=0` leaves the photo files out. A plain
 * GET so the browser just downloads it.
 */
export function exportRoutes(db: Db, dataDir: string) {
  const r = new Hono<AuthEnv>()

  r.get('/', async (c) => {
    // One journal only (archived ones too); another user's id is a 404 like everywhere else.
    const journalId = c.req.query('journalId')
    if (journalId && !reposFor(db, c).journals.get(journalId)) return notFound(c)
    return zipResponse(c, { journalId, media: c.req.query('media') !== '0' })
  })

  // One entry, as a journal file holding it (plus its files): always a zip, since Day One's
  // import only takes zips. Archived journals included; trashed or other users' entries are a 404.
  r.get('/entries/:id', (c) => {
    const entryId = c.req.param('id')
    if (!createRepos(db, c.get('userId')).export.entryInfo(entryId)) return notFound(c)
    return zipResponse(c, { entryId, media: true })
  })

  async function zipResponse(
    c: Context<AuthEnv>,
    opts: { journalId?: string; entryId?: string; media: boolean },
  ) {
    const { filename, stream, missing } = await buildExport({
      db,
      dataDir,
      userId: c.get('userId'),
      ...opts,
    })
    // The one place a lost file shows up; the export carries on without it.
    for (const m of missing)
      console.warn(`export: ${m.kind} ${m.id} (entry ${m.entryId}) has no file at ${m.path}`)
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  }
  return r
}
