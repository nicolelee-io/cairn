import { and, asc, count, desc, eq, inArray, isNull, max, sql } from 'drizzle-orm'
import {
  DEFAULT_PROMPT_ICON,
  MAX_PROMPT_CATEGORIES,
  MAX_SUGGESTED_PROMPTS,
  MAX_USER_PROMPTS,
  isPromptIcon,
  uuidv7,
  type CreatePrompt,
  type CreatePromptCategory,
  type PromptImportFile,
  type PromptImportSummary,
  type SaveSuggested,
  type UpdatePrompt,
  type UpdatePromptCategory,
} from '@cairn/shared'
import type { Db } from '../db/index.ts'
import { promptCategories, prompts } from '../db/schema.ts'

// Two scopes share the `prompt` table: a user's own prompts (`userPrompts`, always filtered by
// user_id) and the admin's suggested ones (`suggestedPrompts`, user_id IS NULL). They are separate
// function sets so a route can't reach one through the other. Categories are server-wide.

export class CategoryNotFoundError extends Error {
  constructor() {
    super('category not found')
  }
}
export class CategoryExistsError extends Error {
  constructor() {
    super('a category with that name exists')
  }
}
/** A cap from `@cairn/shared` (prompts per user, suggested prompts, categories) would be passed. */
export class PromptLimitError extends Error {
  constructor() {
    super('prompt limit reached')
  }
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

function assertCategory(db: Db, id: string | null | undefined) {
  if (!id) return
  if (
    !db
      .select({ id: promptCategories.id })
      .from(promptCategories)
      .where(eq(promptCategories.id, id))
      .get()
  )
    throw new CategoryNotFoundError()
}

/** Oldest first; `rowid` keeps rows written in one millisecond in the order they went in. */
const oldestFirst = [asc(prompts.createdAt), sql`rowid`]

export function promptCategoryRepo(db: Db) {
  const all = () =>
    db
      .select()
      .from(promptCategories)
      .orderBy(asc(promptCategories.position), asc(promptCategories.createdAt))
      .all()

  return {
    list: all,

    create(input: CreatePromptCategory, now = Date.now()) {
      const rows = all()
      if (rows.length >= MAX_PROMPT_CATEGORIES) throw new PromptLimitError()
      if (rows.some((c) => sameName(c.name, input.name))) throw new CategoryExistsError()
      const row = {
        id: uuidv7(now),
        name: input.name,
        icon: input.icon,
        position: Math.max(-1, ...rows.map((c) => c.position)) + 1,
        createdAt: now,
        updatedAt: now,
      }
      db.insert(promptCategories).values(row).run()
      return row
    },

    update(id: string, patch: UpdatePromptCategory, now = Date.now()) {
      const rows = all()
      if (!rows.some((c) => c.id === id)) return undefined
      if (patch.name && rows.some((c) => c.id !== id && sameName(c.name, patch.name!)))
        throw new CategoryExistsError()
      return db
        .update(promptCategories)
        .set({ ...patch, updatedAt: now })
        .where(eq(promptCategories.id, id))
        .returning()
        .get()
    },

    /** Prompts that used it become uncategorized; nothing about them is read or deleted. */
    remove(id: string): boolean {
      return db.transaction((tx) => {
        tx.update(prompts).set({ categoryId: null }).where(eq(prompts.categoryId, id)).run()
        return tx.delete(promptCategories).where(eq(promptCategories.id, id)).run().changes > 0
      })
    },

    /** Position = index in `ids`; unknown and duplicate ids are skipped, unlisted ones follow. */
    reorder(ids: string[], now = Date.now()) {
      db.transaction((tx) => {
        const current = tx
          .select()
          .from(promptCategories)
          .orderBy(asc(promptCategories.position), asc(promptCategories.createdAt))
          .all()
        const known = new Set(current.map((c) => c.id))
        const listed = [...new Set(ids)].filter((id) => known.has(id))
        const order = [...listed, ...current.map((c) => c.id).filter((id) => !listed.includes(id))]
        const was = new Map(current.map((c) => [c.id, c.position]))
        order.forEach((id, position) => {
          if (was.get(id) !== position)
            tx.update(promptCategories)
              .set({ position, updatedAt: now })
              .where(eq(promptCategories.id, id))
              .run()
        })
      })
    },
  }
}

/** Server-wide suggested prompts (user_id IS NULL). Routes gate every write behind an admin. */
export function suggestedPromptRepo(db: Db) {
  const suggested = isNull(prompts.userId)
  const one = (id: string) => and(eq(prompts.id, id), suggested)

  /** What an import would do, checked against the caps, without writing. */
  function plan(file: PromptImportFile) {
    const categories = db.select().from(promptCategories).all()
    const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c]))
    const have = new Set(
      db
        .select({ text: prompts.text })
        .from(prompts)
        .where(suggested)
        .all()
        .map((p) => p.text),
    )
    const created = new Map<string, { name: string; icon: string }>()
    const adds: { category: string; text: string }[] = [] // category = lowercased name
    const summary: PromptImportSummary = {
      newCategories: 0,
      newPrompts: 0,
      existingPrompts: 0,
      unknownIcons: 0,
    }
    for (const c of file.categories) {
      const key = c.name.toLowerCase()
      if (!byName.has(key) && !created.has(key)) {
        const known = c.icon !== undefined && isPromptIcon(c.icon)
        if (c.icon !== undefined && !known) summary.unknownIcons++
        created.set(key, { name: c.name, icon: known ? c.icon! : DEFAULT_PROMPT_ICON })
        summary.newCategories++
      }
      for (const text of c.prompts) {
        if (have.has(text)) summary.existingPrompts++
        else {
          have.add(text)
          adds.push({ category: key, text })
          summary.newPrompts++
        }
      }
    }
    const existing = db.select({ n: count() }).from(prompts).where(suggested).get()?.n ?? 0
    if (
      categories.length + summary.newCategories > MAX_PROMPT_CATEGORIES ||
      existing + summary.newPrompts > MAX_SUGGESTED_PROMPTS
    )
      throw new PromptLimitError()
    return { summary, created, adds, byName }
  }

  return {
    list: () =>
      db
        .select()
        .from(prompts)
        .where(suggested)
        .orderBy(...oldestFirst)
        .all(),

    create(input: CreatePrompt, now = Date.now()) {
      assertCategory(db, input.categoryId)
      const total = db.select({ n: count() }).from(prompts).where(suggested).get()?.n ?? 0
      if (total >= MAX_SUGGESTED_PROMPTS) throw new PromptLimitError()
      const row = {
        id: uuidv7(now),
        userId: null,
        text: input.text,
        categoryId: input.categoryId,
        sourcePromptId: null,
        createdAt: now,
        updatedAt: now,
      }
      db.insert(prompts).values(row).run()
      return row
    },

    update(id: string, patch: UpdatePrompt, now = Date.now()) {
      assertCategory(db, patch.categoryId)
      return db
        .update(prompts)
        .set({ ...patch, updatedAt: now })
        .where(one(id))
        .returning()
        .get()
    },

    /** A user's saved copy is left alone (no FK on `source_prompt_id`). */
    remove: (id: string) => db.delete(prompts).where(one(id)).run().changes > 0,

    /** Several at once; ids that aren't suggested prompts are skipped. Returns how many were deleted. */
    removeMany: (ids: string[]) =>
      db
        .delete(prompts)
        .where(and(inArray(prompts.id, ids), suggested))
        .run().changes,

    /** Merge only: categories match by name ignoring case, a prompt already there is skipped. */
    importFile(
      file: PromptImportFile,
      { dryRun = false } = {},
      now = Date.now(),
    ): PromptImportSummary {
      return db.transaction((tx) => {
        const p = suggestedPromptRepo(tx).plan(file)
        if (dryRun) return p.summary
        const ids = new Map<string, string>()
        for (const [key, c] of p.byName) ids.set(key, c.id)
        let position =
          (tx
            .select({ m: max(promptCategories.position) })
            .from(promptCategories)
            .get()?.m ?? -1) + 1
        for (const [key, c] of p.created) {
          const id = uuidv7(now)
          tx.insert(promptCategories)
            .values({
              id,
              name: c.name,
              icon: c.icon,
              position: position++,
              createdAt: now,
              updatedAt: now,
            })
            .run()
          ids.set(key, id)
        }
        if (p.adds.length)
          tx.insert(prompts)
            .values(
              p.adds.map((a) => ({
                id: uuidv7(now),
                userId: null,
                text: a.text,
                categoryId: ids.get(a.category)!,
                sourcePromptId: null,
                createdAt: now,
                updatedAt: now,
              })),
            )
            .run()
        return p.summary
      })
    },
    plan,
  }
}

/** The caller's own prompts. Every query is filtered by `userId`. */
export function userPromptRepo(db: Db, userId: string) {
  const mine = eq(prompts.userId, userId)
  const one = (id: string) => and(eq(prompts.id, id), mine)
  const total = (d: Db) => d.select({ n: count() }).from(prompts).where(mine).get()?.n ?? 0

  return {
    list: () =>
      db
        .select()
        .from(prompts)
        .where(mine)
        .orderBy(desc(prompts.createdAt), desc(sql`rowid`))
        .all(),

    create(input: CreatePrompt, now = Date.now()) {
      return db.transaction((tx) => {
        assertCategory(tx, input.categoryId)
        if (total(tx) >= MAX_USER_PROMPTS) throw new PromptLimitError()
        const row = {
          id: uuidv7(now),
          userId,
          text: input.text,
          categoryId: input.categoryId,
          sourcePromptId: null,
          createdAt: now,
          updatedAt: now,
        }
        tx.insert(prompts).values(row).run()
        return row
      })
    },

    update(id: string, patch: UpdatePrompt, now = Date.now()) {
      assertCategory(db, patch.categoryId)
      return db
        .update(prompts)
        .set({ ...patch, updatedAt: now })
        .where(one(id))
        .returning()
        .get()
    },

    remove: (id: string) => db.delete(prompts).where(one(id)).run().changes > 0,

    /** Several at once; ids that aren't the caller's own are skipped. Returns how many were deleted. */
    removeMany: (ids: string[]) =>
      db
        .delete(prompts)
        .where(and(inArray(prompts.id, ids), mine))
        .run().changes,

    /**
     * Copies suggested prompts (by id, or a whole category) into the caller's list. One already
     * saved (a copy with that `source_prompt_id`) is skipped, so a repeat saves nothing new.
     * Returns how many were copied; over the cap nothing is.
     */
    saveSuggested(input: SaveSuggested, now = Date.now()): number {
      return db.transaction((tx) => {
        const wanted = tx
          .select()
          .from(prompts)
          .where(
            and(
              isNull(prompts.userId),
              'ids' in input
                ? inArray(prompts.id, input.ids)
                : eq(prompts.categoryId, input.categoryId),
            ),
          )
          .orderBy(...oldestFirst)
          .all()
        const saved = new Set(
          tx
            .select({ source: prompts.sourcePromptId })
            .from(prompts)
            .where(mine)
            .all()
            .map((r) => r.source),
        )
        const fresh = wanted.filter((p) => !saved.has(p.id))
        if (!fresh.length) return 0
        if (total(tx) + fresh.length > MAX_USER_PROMPTS) throw new PromptLimitError()
        tx.insert(prompts)
          .values(
            fresh.map((p) => ({
              id: uuidv7(now),
              userId,
              text: p.text,
              categoryId: p.categoryId,
              sourcePromptId: p.id,
              createdAt: now,
              updatedAt: now,
            })),
          )
          .run()
        return fresh.length
      })
    },
  }
}
