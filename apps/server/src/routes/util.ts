import type { Context } from 'hono'
import type { ZodType, z } from 'zod'
import type { AuthEnv } from '../auth/middleware.ts'
import type { Db } from '../db/index.ts'
import { createRepos } from '../repo/index.ts'

/** Handlers get a repo bundle already scoped to the session's user; they never see the schema. */
export const reposFor = (db: Db, c: Context<AuthEnv>) => createRepos(db, c.get('userId'))

/** Parses a JSON body; null means "respond 400". */
export async function parseBody<S extends ZodType>(
  c: Context,
  schema: S,
): Promise<z.infer<S> | null> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null))
  return parsed.success ? parsed.data : null
}

export const badRequest = (c: Context) => c.json({ error: 'invalid_request' }, 400)
export const notFound = (c: Context) => c.json({ error: 'not_found' }, 404)
