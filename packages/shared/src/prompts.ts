import { z } from 'zod'

// Writing prompts (docs/design/prompts-proposal.md). A user's own prompts are user content; the admin keeps
// a server-wide list of suggested prompts (user_id null) and the categories both kinds use.

export const PROMPT_MAX_LENGTH = 200
export const MAX_USER_PROMPTS = 2000
export const MAX_SUGGESTED_PROMPTS = 2000
export const MAX_PROMPT_CATEGORIES = 30
export const CATEGORY_NAME_MAX_LENGTH = 40
/** The JSON import: file size (bytes, checked by the route) and prompts across all categories. */
export const PROMPT_IMPORT_MAX_BYTES = 1024 * 1024
export const PROMPT_IMPORT_MAX_PROMPTS = 500

/** Material Symbols names an admin can give a category. Anything else imports as the default. */
export const PROMPT_ICONS = [
  'edit_note',
  'psychology',
  'favorite',
  'sentiment_satisfied',
  'self_improvement',
  'spa',
  'lightbulb',
  'menu_book',
  'star',
  'sunny',
  'nightlight',
  'travel_explore',
  'restaurant',
  'group',
  'family_restroom',
  'work',
  'school',
  'flag',
  'eco',
  'celebration',
  'pets',
  'music_note',
] as const
export type PromptIcon = (typeof PROMPT_ICONS)[number]
export const DEFAULT_PROMPT_ICON: PromptIcon = 'edit_note'
export const isPromptIcon = (s: string) => (PROMPT_ICONS as readonly string[]).includes(s)
export const PromptIconSchema = z.enum(PROMPT_ICONS)

export const PromptTextSchema = z.string().trim().min(1).max(PROMPT_MAX_LENGTH)
export const CategoryNameSchema = z.string().trim().min(1).max(CATEGORY_NAME_MAX_LENGTH)

export const PromptCategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string(),
  position: z.number(),
})
export type PromptCategory = z.infer<typeof PromptCategorySchema>

/** GET /api/prompts/categories. */
export const PromptCategoriesSchema = z.object({ categories: z.array(PromptCategorySchema) })

export const CreatePromptCategorySchema = z.object({
  name: CategoryNameSchema,
  icon: PromptIconSchema.default(DEFAULT_PROMPT_ICON),
})
export type CreatePromptCategory = z.infer<typeof CreatePromptCategorySchema>

export const UpdatePromptCategorySchema = z
  .object({ name: CategoryNameSchema, icon: PromptIconSchema })
  .partial()
  .refine((v) => Object.keys(v).length > 0)
export type UpdatePromptCategory = z.infer<typeof UpdatePromptCategorySchema>

/** PUT /api/prompts/categories/order: ids in the new order (unknown and duplicate ids are skipped). */
export const ReorderPromptCategoriesSchema = z.object({ ids: z.array(z.string()).max(200) })

/** A suggested prompt, as everyone sees it. */
export const SuggestedPromptSchema = z.object({
  id: z.string(),
  text: z.string(),
  categoryId: z.string().nullable(),
})
export type SuggestedPrompt = z.infer<typeof SuggestedPromptSchema>

/** GET /api/prompts/suggested: oldest first, so an imported file keeps its order. */
export const SuggestedPromptsSchema = z.object({ prompts: z.array(SuggestedPromptSchema) })

/** One of the caller's own prompts. `sourcePromptId` names the suggested prompt it was saved from. */
export const PromptSchema = SuggestedPromptSchema.extend({
  sourcePromptId: z.string().nullable(),
  createdAt: z.number(),
})
export type Prompt = z.infer<typeof PromptSchema>

/** GET /api/prompts/mine: newest first. */
export const PromptsSchema = z.object({ prompts: z.array(PromptSchema) })

export const CreatePromptSchema = z.object({
  text: PromptTextSchema,
  categoryId: z.string().nullable().default(null),
})
export type CreatePrompt = z.infer<typeof CreatePromptSchema>

export const UpdatePromptSchema = z
  .object({ text: PromptTextSchema, categoryId: z.string().nullable() })
  .partial()
  .refine((v) => Object.keys(v).length > 0)
export type UpdatePrompt = z.infer<typeof UpdatePromptSchema>

/** POST /api/prompts/mine/from-suggested: save some suggested prompts by id, or a whole category. */
export const SaveSuggestedSchema = z.union([
  z.object({ ids: z.array(z.string()).min(1).max(MAX_SUGGESTED_PROMPTS) }),
  z.object({ categoryId: z.string() }),
])
export type SaveSuggested = z.infer<typeof SaveSuggestedSchema>

/** POST /api/prompts/mine/bulk-delete and /api/prompts/suggested/bulk-delete: ids to delete (unknown ones are skipped). */
export const BulkDeletePromptsSchema = z.object({
  ids: z.array(z.string()).min(1).max(MAX_SUGGESTED_PROMPTS),
})
export type BulkDeletePrompts = z.infer<typeof BulkDeletePromptsSchema>

/** How many prompts a bulk delete removed. */
export const BulkDeletedPromptsSchema = z.object({ deleted: z.number() })
export type BulkDeletedPrompts = z.infer<typeof BulkDeletedPromptsSchema>

/** How many prompts were newly copied (ones already saved, and unknown ids, are not counted). */
export const SavedSuggestedSchema = z.object({ saved: z.number() })
export type SavedSuggested = z.infer<typeof SavedSuggestedSchema>

/**
 * The hand-written (or LLM-written) import file:
 * `{ "categories": [{ "name": "Reflection", "icon": "psychology", "prompts": ["..."] }] }`.
 */
export const PromptImportFileSchema = z
  .object({
    categories: z
      .array(
        z.object({
          name: CategoryNameSchema,
          // Not validated against PROMPT_ICONS: an unknown one is counted and the default is used.
          icon: z.string().max(60).optional(),
          prompts: z.array(PromptTextSchema),
        }),
      )
      .max(MAX_PROMPT_CATEGORIES),
  })
  .refine(
    (f) => f.categories.reduce((n, c) => n + c.prompts.length, 0) <= PROMPT_IMPORT_MAX_PROMPTS,
    `at most ${PROMPT_IMPORT_MAX_PROMPTS} prompts`,
  )
export type PromptImportFile = z.infer<typeof PromptImportFileSchema>

/** POST /api/prompts/suggested/import. `dryRun` returns the summary without writing anything. */
export const PromptImportRequestSchema = z.object({
  file: PromptImportFileSchema,
  dryRun: z.boolean().default(false),
})

/** What an import did (or, for a dry run, would do). */
export const PromptImportSummarySchema = z.object({
  newCategories: z.number(),
  newPrompts: z.number(),
  /** Prompts skipped because the exact text is already a suggested prompt (or repeats in the file). */
  existingPrompts: z.number(),
  /** New categories whose icon isn't in PROMPT_ICONS (they get the default). */
  unknownIcons: z.number(),
})
export type PromptImportSummary = z.infer<typeof PromptImportSummarySchema>
