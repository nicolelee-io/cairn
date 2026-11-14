import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useReducer, useState } from 'react'
import type { ZodType } from 'zod'
import {
  BulkDeletedPromptsSchema,
  PROMPT_MAX_LENGTH,
  PromptCategoriesSchema,
  PromptCategorySchema,
  PromptImportSummarySchema,
  PromptSchema,
  PromptsSchema,
  SavedSuggestedSchema,
  SuggestedPromptSchema,
  SuggestedPromptsSchema,
  type CreatePrompt,
  type CreatePromptCategory,
  type PromptImportFile,
  type UpdatePromptCategory,
  type Prompt,
  type PromptCategory,
  type SaveSuggested,
  type SuggestedPrompt,
  type UpdatePrompt,
} from '@cairn/shared'
import { useMe } from '../auth/useAuth.ts'
import { api } from './api.ts'
import { dailyPrompts, type DailyState } from './dailyPrompts.ts'
import { dayKey } from './format.ts'
import { PROMPTS_CACHE } from './cachePrefixes.ts'
import { useCachedList } from './cachedList.ts'
import { keys } from './queries.ts'

// Writing prompts (docs/design/prompts-proposal.md). Online only: prompts are not in the offline copies. The
// last lists fetched are kept in localStorage so the daily cards still show without a connection.

const useCachedPrompts = <T>(
  name: string,
  queryKey: readonly string[],
  path: string,
  schema: ZodType<T>,
) => useCachedList(PROMPTS_CACHE, name, queryKey, path, schema)

export const usePromptCategories = () =>
  useCachedPrompts(
    'categories',
    keys.promptCategories,
    '/prompts/categories',
    PromptCategoriesSchema,
  )

/** The caller's own prompts, newest first. */
export const useMyPrompts = () =>
  useCachedPrompts('mine', keys.promptsMine, '/prompts/mine', PromptsSchema)

/** The admin's suggested prompts, oldest first. */
export const useSuggestedPrompts = () =>
  useCachedPrompts('suggested', keys.promptsSuggested, '/prompts/suggested', SuggestedPromptsSchema)

/**
 * What a new entry starts with when it is written from a prompt: the prompt as a `# ` heading (which
 * `summarize()` takes as the entry's title) and a blank line, so the caret lands on the body. Line
 * breaks in a pasted link collapse to spaces and the length is capped.
 */
export const promptHeading = (text: string) =>
  `# ${text.replace(/\s+/g, ' ').trim().slice(0, PROMPT_MAX_LENGTH)}\n\n`

/** Where "write about this" goes: a new entry that starts with the prompt as its heading. */
export const promptPath = (text: string) => `/new?prompt=${encodeURIComponent(text)}`

/** A category by id, or undefined (uncategorized, or one an admin has since deleted). */
export const categoryById = (categories: PromptCategory[] | undefined, id: string | null) =>
  id ? categories?.find((c) => c.id === id) : undefined

export interface SuggestedGroup {
  /** The category, or null for prompts with none (or whose category an admin has since deleted). */
  category: PromptCategory | null
  prompts: SuggestedPrompt[]
}

/**
 * Suggested prompts grouped for browsing: one group per category in the admin's order (empty
 * categories left out), then the uncategorized ones. Within a group the prompts keep their order.
 */
export function groupSuggested(
  prompts: SuggestedPrompt[],
  categories: PromptCategory[],
): SuggestedGroup[] {
  const byCategory = new Map<string, SuggestedPrompt[]>()
  const loose: SuggestedPrompt[] = []
  const known = new Set(categories.map((c) => c.id))
  for (const p of prompts) {
    if (p.categoryId && known.has(p.categoryId)) {
      const list = byCategory.get(p.categoryId) ?? []
      list.push(p)
      byCategory.set(p.categoryId, list)
    } else loose.push(p)
  }
  const groups: SuggestedGroup[] = [...categories]
    .sort((a, b) => a.position - b.position)
    .flatMap((category) => {
      const list = byCategory.get(category.id)
      return list ? [{ category, prompts: list }] : []
    })
  if (loose.length) groups.push({ category: null, prompts: loose })
  return groups
}

/** The ids of suggested prompts the user already has a copy of. */
export const savedSourceIds = (mine: Prompt[] | undefined) =>
  new Set(mine?.flatMap((p) => (p.sourcePromptId ? [p.sourcePromptId] : [])))

export function useAddPrompt() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreatePrompt) =>
      api('/prompts/mine', { method: 'POST', body: input, schema: PromptSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.prompts }),
  })
}

export function useUpdatePrompt() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...patch }: UpdatePrompt & { id: string }) =>
      api(`/prompts/mine/${id}`, { method: 'PATCH', body: patch, schema: PromptSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.prompts }),
  })
}

export function useDeletePrompt() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api(`/prompts/mine/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.prompts }),
  })
}

/** Deletes several of the caller's own prompts at once; resolves to how many went. */
export function useDeleteMyPrompts() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (ids: string[]) =>
      (
        await api('/prompts/mine/bulk-delete', {
          method: 'POST',
          body: { ids },
          schema: BulkDeletedPromptsSchema,
        })
      ).deleted,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.prompts }),
  })
}

/** Saves suggested prompts into the caller's list (by id, or a whole category); resolves to how many were new. */
export function useSaveSuggested() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: SaveSuggested) =>
      (
        await api('/prompts/mine/from-suggested', {
          method: 'POST',
          body: input,
          schema: SavedSuggestedSchema,
        })
      ).saved,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.promptsMine }),
  })
}

// ---- Daily prompts, and three from a category ----

// Both draw from a shuffle bag kept in localStorage (lib/dailyPrompts.ts), so nothing repeats until
// the list is used up. Daily's is keyed by day; a category's never expires, only a refresh draws.
const dailyKey = (userId: string) => `cairn:prompts-daily:${userId}`
const categoryBagKey = (userId: string, categoryId: string) =>
  `cairn:prompts-bag:${userId}:${categoryId}`
const pickKey = (userId: string) => `cairn:prompts-category:${userId}`

function loadBag(key: string): DailyState | null {
  try {
    const raw = localStorage.getItem(key)
    const s = raw ? (JSON.parse(raw) as Partial<DailyState>) : null
    return s &&
      typeof s.day === 'string' &&
      typeof s.sig === 'string' &&
      typeof s.pos === 'number' &&
      Array.isArray(s.shown) &&
      Array.isArray(s.bag)
      ? (s as DailyState)
      : null
  } catch {
    return null
  }
}

function saveBag(key: string, state: DailyState) {
  try {
    localStorage.setItem(key, JSON.stringify(state))
  } catch {
    // Not kept: the cards just change on the next load.
  }
}

/** The drawn prompts, in order, from the ids a bag state shows. */
const promptsOf = (state: DailyState, prompts: Prompt[]) => {
  const byId = new Map(prompts.map((p) => [p.id, p]))
  return state.shown.flatMap((id) => byId.get(id) ?? [])
}

/**
 * Today's three prompts from the user's own list, stable through the day (see lib/dailyPrompts.ts),
 * and `refresh` for three new ones. `prompts` undefined = still loading.
 */
export function useDailyPrompts(prompts: Prompt[] | undefined) {
  const me = useMe().data
  const tz = me?.defaultTimezone ?? 'UTC'
  const userId = me?.id
  // A refresh writes the new state to storage, then re-reads it: this counter is the re-read.
  const [version, bump] = useReducer((n: number) => n + 1, 0)
  const [now] = useState(() => Date.now())
  const today = dayKey(now, tz)

  const shown = useMemo(() => {
    void version
    if (!userId || !prompts) return undefined
    const state = dailyPrompts(
      loadBag(dailyKey(userId)),
      prompts.map((p) => p.id),
      today,
    )
    saveBag(dailyKey(userId), state)
    return promptsOf(state, prompts)
  }, [userId, prompts, today, version])

  const refresh = () => {
    if (!userId || !prompts) return
    saveBag(
      dailyKey(userId),
      dailyPrompts(
        loadBag(dailyKey(userId)),
        prompts.map((p) => p.id),
        today,
        { refresh: true },
      ),
    )
    bump()
  }
  return { shown, refresh }
}

/** The categories the user's own prompts use, in the admin's order (only these can be picked from). */
export const categoriesInUse = (
  prompts: Prompt[] | undefined,
  categories: PromptCategory[] | undefined,
) =>
  (categories ?? [])
    .filter((c) => prompts?.some((p) => p.categoryId === c.id))
    .sort((a, b) => a.position - b.position)

/**
 * "Pick a category": the chosen category (remembered on this device) and three prompts from it,
 * drawn when it is chosen and again on `refresh`, from a shuffle bag per category.
 * `choose(null)` clears it. A category that no longer has prompts counts as not chosen.
 */
export function useCategoryPrompts(prompts: Prompt[] | undefined) {
  const userId = useMe().data?.id
  const [version, bump] = useReducer((n: number) => n + 1, 0)

  const categoryId = useMemo(() => {
    void version
    if (!userId || !prompts) return null
    const picked = localStorage.getItem(pickKey(userId))
    return picked && prompts.some((p) => p.categoryId === picked) ? picked : null
  }, [userId, prompts, version])

  const draw = (refresh: boolean) => {
    if (!userId || !prompts || !categoryId) return undefined
    const mine = prompts.filter((p) => p.categoryId === categoryId)
    const key = categoryBagKey(userId, categoryId)
    // The day never changes ('-'), so what was drawn stays until a refresh or a changed list.
    const state = dailyPrompts(
      loadBag(key),
      mine.map((p) => p.id),
      '-',
      { refresh },
    )
    saveBag(key, state)
    return promptsOf(state, mine)
  }
  const shown = useMemo(() => draw(false), [userId, prompts, categoryId, version]) // eslint-disable-line react-hooks/exhaustive-deps -- draw reads exactly these

  const choose = (id: string | null) => {
    if (!userId || !prompts) return
    try {
      if (id) localStorage.setItem(pickKey(userId), id)
      else localStorage.removeItem(pickKey(userId))
    } catch {
      // Not remembered: it still applies until the page reloads.
    }
    if (id) {
      const mine = prompts.filter((p) => p.categoryId === id)
      const key = categoryBagKey(userId, id)
      // Choosing draws fresh ones, taken from the bag so a category cycles through before repeating.
      saveBag(
        key,
        dailyPrompts(
          loadBag(key),
          mine.map((p) => p.id),
          '-',
          { refresh: true },
        ),
      )
    }
    bump()
  }
  const refresh = () => {
    draw(true)
    bump()
  }
  return { categoryId, shown, choose, refresh }
}

// ---- Admin: categories and suggested prompts (the server refuses anyone else) ----

/** A write to the server-wide lists: the caller's own prompts carry categories too, so refresh them all. */
function useAdminWrite<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.prompts }),
  })
}

export const useCreateCategory = () =>
  useAdminWrite((input: CreatePromptCategory) =>
    api('/prompts/categories', { method: 'POST', body: input, schema: PromptCategorySchema }),
  )

export const useUpdateCategory = () =>
  useAdminWrite(({ id, ...patch }: UpdatePromptCategory & { id: string }) =>
    api(`/prompts/categories/${id}`, {
      method: 'PATCH',
      body: patch,
      schema: PromptCategorySchema,
    }),
  )

export const useDeleteCategory = () =>
  useAdminWrite((id: string) => api(`/prompts/categories/${id}`, { method: 'DELETE' }))

export function useReorderCategories() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[]) =>
      api('/prompts/categories/order', {
        method: 'PUT',
        body: { ids },
        schema: PromptCategoriesSchema,
      }),
    // The new order shows at once; a failure re-reads the server's.
    onMutate: (ids) => {
      qc.setQueryData<{ categories: PromptCategory[] }>(
        keys.promptCategories,
        (old) =>
          old && {
            categories: old.categories
              .map((c) => ({ ...c, position: ids.includes(c.id) ? ids.indexOf(c.id) : c.position }))
              .sort((a, b) => a.position - b.position),
          },
      )
    },
    onError: () => void qc.invalidateQueries({ queryKey: keys.promptCategories }),
    onSuccess: (list) => qc.setQueryData(keys.promptCategories, list),
  })
}

export const useCreateSuggested = () =>
  useAdminWrite((input: CreatePrompt) =>
    api('/prompts/suggested', { method: 'POST', body: input, schema: SuggestedPromptSchema }),
  )

export const useUpdateSuggested = () =>
  useAdminWrite(({ id, ...patch }: UpdatePrompt & { id: string }) =>
    api(`/prompts/suggested/${id}`, {
      method: 'PATCH',
      body: patch,
      schema: SuggestedPromptSchema,
    }),
  )

export const useDeleteSuggested = () =>
  useAdminWrite((id: string) => api(`/prompts/suggested/${id}`, { method: 'DELETE' }))

/** The JSON import: `dryRun` answers with what it would do and writes nothing. */
export const useImportPrompts = () =>
  useAdminWrite(({ file, dryRun }: { file: PromptImportFile; dryRun: boolean }) =>
    api('/prompts/suggested/import', {
      method: 'POST',
      body: { file, dryRun },
      schema: PromptImportSummarySchema,
    }),
  )

/** Admin: deletes several suggested prompts at once; resolves to how many went. */
export const useDeleteSuggestedMany = () =>
  useAdminWrite(
    async (ids: string[]) =>
      (
        await api('/prompts/suggested/bulk-delete', {
          method: 'POST',
          body: { ids },
          schema: BulkDeletedPromptsSchema,
        })
      ).deleted,
  )
