import { Hono } from 'hono'
import {
  StartImportSchema,
  type ImportJob,
  type ImportPreview,
  type ImportStatus,
} from '@cairn/shared'
import type { AuthEnv } from '../auth/middleware.ts'
import { FileTooLargeError } from '../attachments/upload.ts'
import { attachmentLimit } from '../attachments/limit.ts'
import type { Db } from '../db/index.ts'
import {
  ExportTooLargeError,
  ImportBusyError,
  UnsupportedExportError,
  type ImportJobs,
} from '../import/jobs.ts'
import { badRequest, notFound, parseBody } from './util.ts'

const BUSY = {
  error: 'import_busy',
  message: 'Another import is running. Try again when it has finished.',
} as const

/**
 * Importing an export into the signed-in user's own account (`import/jobs.ts`). The upload is the
 * raw zip (`PUT /?name=`), streamed to disk like an attachment and capped by the same limit (the
 * CLI is the way past it); it answers with a preview, and nothing is written until it is started.
 */
export function importRoutes(db: Db, imports: ImportJobs) {
  const limit = attachmentLimit(db)
  const r = new Hono<AuthEnv>()

  r.get('/', (c) => c.json<ImportStatus>(imports.status(c.get('userId'))))

  r.put('/', async (c) => {
    const mb = limit.mb()
    const maxBytes = mb * 1024 * 1024
    const tooLarge = {
      error: 'too_large',
      message: `That file is over ${mb} MB. Larger exports can be imported from the command line.`,
    }
    if (Number(c.req.header('content-length')) > maxBytes) return c.json(tooLarge, 413)
    const body = c.req.raw.body
    if (!body) return badRequest(c)
    const filename = (c.req.query('name') ?? '').split(/[/\\]/).pop()!.slice(0, 200) || 'export.zip'
    try {
      const preview = await imports.upload(c.get('userId'), body, { filename, maxBytes })
      return c.json<ImportPreview>(preview, 201)
    } catch (e) {
      if (e instanceof FileTooLargeError) return c.json(tooLarge, 413)
      if (e instanceof ExportTooLargeError)
        return c.json(
          {
            error: 'too_large',
            message: 'That export unpacks to more than can be imported here. Use the command line.',
          },
          413,
        )
      if (e instanceof UnsupportedExportError)
        return c.json(
          {
            error: 'unsupported_format',
            message:
              'That isn’t an export Cairn can read. Choose a Day One JSON export or a Cairn export (a zip).',
          },
          415,
        )
      if (e instanceof ImportBusyError) return c.json(BUSY, 409)
      throw e
    }
  })

  r.post('/:id/start', async (c) => {
    const body = await parseBody(c, StartImportSchema)
    if (!body) return badRequest(c)
    try {
      const job = imports.start(c.get('userId'), c.req.param('id'), body.archived)
      return job ? c.json<ImportJob>(job, 202) : notFound(c)
    } catch (e) {
      if (e instanceof ImportBusyError) return c.json(BUSY, 409)
      throw e
    }
  })

  r.delete('/:id', (c) =>
    imports.cancel(c.get('userId'), c.req.param('id')) ? c.body(null, 204) : notFound(c),
  )

  return r
}
