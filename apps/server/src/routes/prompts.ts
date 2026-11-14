import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import {
  BulkDeletePromptsSchema,
  CreatePromptCategorySchema,
  CreatePromptSchema,
  PROMPT_IMPORT_MAX_BYTES,
  PromptImportRequestSchema,
  ReorderPromptCategoriesSchema,
  SaveSuggestedSchema,
  UpdatePromptCategorySchema,
  UpdatePromptSchema,
  type Prompt,
  type PromptCategory,
  type SuggestedPrompt,
} from '@cairn/shared'
import type { AuthEnv } from '../auth/middleware.ts'
import type { Db } from '../db/index.ts'
import type { promptCategories, prompts } from '../db/schema.ts'
import {
  CategoryExistsError,
  CategoryNotFoundError,
  PromptLimitError,
  promptCategoryRepo,
  suggestedPromptRepo,
} from '../repo/prompts.ts'
import { badRequest, notFound, parseBody, reposFor } from './util.ts'

const toCategory = (c: typeof promptCategories.$inferSelect): PromptCategory => ({
  id: c.id,
  name: c.name,
  icon: c.icon,
  position: c.position,
})
const toSuggested = (p: typeof prompts.$inferSelect): SuggestedPrompt => ({
  id: p.id,
  text: p.text,
  categoryId: p.categoryId,
})
const toPrompt = (p: typeof prompts.$inferSelect): Prompt => ({
  ...toSuggested(p),
  sourcePromptId: p.sourcePromptId,
  createdAt: p.createdAt,
})

/**
 * Writing prompts. `/mine/*` is the caller's own (through the repo bundle). Categories and
 * suggested prompts are server-wide: everyone reads them, and `app.ts` gates every write behind
 * `requireAdmin` before this router.
 */
export function promptRoutes(db: Db) {
  const r = new Hono<AuthEnv>()
  const categories = promptCategoryRepo(db)
  const suggested = suggestedPromptRepo(db)

  const failed = (c: Context, e: unknown) => {
    if (e instanceof CategoryNotFoundError) return c.json({ error: 'unknown_category' }, 400)
    if (e instanceof CategoryExistsError) return c.json({ error: 'category_exists' }, 409)
    if (e instanceof PromptLimitError) return c.json({ error: 'limit_reached' }, 409)
    throw e
  }

  r.get('/categories', (c) => c.json({ categories: categories.list().map(toCategory) }))

  r.post('/categories', async (c) => {
    const body = await parseBody(c, CreatePromptCategorySchema)
    if (!body) return badRequest(c)
    try {
      return c.json(toCategory(categories.create(body)), 201)
    } catch (e) {
      return failed(c, e)
    }
  })

  r.put('/categories/order', async (c) => {
    const body = await parseBody(c, ReorderPromptCategoriesSchema)
    if (!body) return badRequest(c)
    categories.reorder(body.ids)
    return c.json({ categories: categories.list().map(toCategory) })
  })

  r.patch('/categories/:id', async (c) => {
    const body = await parseBody(c, UpdatePromptCategorySchema)
    if (!body) return badRequest(c)
    try {
      const row = categories.update(c.req.param('id'), body)
      return row ? c.json(toCategory(row)) : notFound(c)
    } catch (e) {
      return failed(c, e)
    }
  })

  r.delete('/categories/:id', (c) =>
    categories.remove(c.req.param('id')) ? c.body(null, 204) : notFound(c),
  )

  r.get('/suggested', (c) => c.json({ prompts: suggested.list().map(toSuggested) }))

  r.post('/suggested', async (c) => {
    const body = await parseBody(c, CreatePromptSchema)
    if (!body) return badRequest(c)
    try {
      return c.json(toSuggested(suggested.create(body)), 201)
    } catch (e) {
      return failed(c, e)
    }
  })

  // The file is capped at 1 MB; `dryRun` answers with the summary and writes nothing.
  r.post(
    '/suggested/import',
    bodyLimit({
      maxSize: PROMPT_IMPORT_MAX_BYTES + 1024,
      onError: (c) => c.json({ error: 'too_large' }, 413),
    }),
    async (c) => {
      const body = await parseBody(c, PromptImportRequestSchema)
      if (!body) return badRequest(c)
      try {
        return c.json(suggested.importFile(body.file, { dryRun: body.dryRun }))
      } catch (e) {
        return failed(c, e)
      }
    },
  )

  r.post('/suggested/bulk-delete', async (c) => {
    const body = await parseBody(c, BulkDeletePromptsSchema)
    if (!body) return badRequest(c)
    return c.json({ deleted: suggested.removeMany(body.ids) })
  })

  r.patch('/suggested/:id', async (c) => {
    const body = await parseBody(c, UpdatePromptSchema)
    if (!body) return badRequest(c)
    try {
      const row = suggested.update(c.req.param('id'), body)
      return row ? c.json(toSuggested(row)) : notFound(c)
    } catch (e) {
      return failed(c, e)
    }
  })

  r.delete('/suggested/:id', (c) =>
    suggested.remove(c.req.param('id')) ? c.body(null, 204) : notFound(c),
  )

  r.get('/mine', (c) => c.json({ prompts: reposFor(db, c).prompts.list().map(toPrompt) }))

  r.post('/mine', async (c) => {
    const body = await parseBody(c, CreatePromptSchema)
    if (!body) return badRequest(c)
    try {
      return c.json(toPrompt(reposFor(db, c).prompts.create(body)), 201)
    } catch (e) {
      return failed(c, e)
    }
  })

  r.post('/mine/from-suggested', async (c) => {
    const body = await parseBody(c, SaveSuggestedSchema)
    if (!body) return badRequest(c)
    try {
      return c.json({ saved: reposFor(db, c).prompts.saveSuggested(body) })
    } catch (e) {
      return failed(c, e)
    }
  })

  r.post('/mine/bulk-delete', async (c) => {
    const body = await parseBody(c, BulkDeletePromptsSchema)
    if (!body) return badRequest(c)
    return c.json({ deleted: reposFor(db, c).prompts.removeMany(body.ids) })
  })

  r.patch('/mine/:id', async (c) => {
    const body = await parseBody(c, UpdatePromptSchema)
    if (!body) return badRequest(c)
    try {
      const row = reposFor(db, c).prompts.update(c.req.param('id'), body)
      return row ? c.json(toPrompt(row)) : notFound(c)
    } catch (e) {
      return failed(c, e)
    }
  })

  r.delete('/mine/:id', (c) =>
    reposFor(db, c).prompts.remove(c.req.param('id')) ? c.body(null, 204) : notFound(c),
  )

  return r
}
