import { z } from 'zod'

// Entry templates: a user's saved text (a name and a markdown body) that the editor inserts at the
// caret. Per user, no server defaults, text only (no photos). Like writing prompts they are
// settings-like data: no rev, tombstones or sync feed.

export const TEMPLATE_NAME_MAX_LENGTH = 80
export const TEMPLATE_BODY_MAX_LENGTH = 20_000
export const MAX_USER_TEMPLATES = 100

export const TemplateNameSchema = z.string().trim().min(1).max(TEMPLATE_NAME_MAX_LENGTH)
/** Not trimmed (a template may start with a blank line or end on a list marker), but never blank. */
export const TemplateBodySchema = z
  .string()
  .max(TEMPLATE_BODY_MAX_LENGTH)
  .refine((s) => s.trim().length > 0, 'empty')

export const TemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  bodyMd: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type Template = z.infer<typeof TemplateSchema>

/** GET /api/templates. */
export const TemplatesSchema = z.object({ templates: z.array(TemplateSchema) })
export type Templates = z.infer<typeof TemplatesSchema>

export const CreateTemplateSchema = z.object({
  name: TemplateNameSchema,
  bodyMd: TemplateBodySchema,
})
export type CreateTemplate = z.infer<typeof CreateTemplateSchema>

export const UpdateTemplateSchema = z
  .object({ name: TemplateNameSchema, bodyMd: TemplateBodySchema })
  .partial()
  .refine((p) => p.name !== undefined || p.bodyMd !== undefined, 'nothing to change')
export type UpdateTemplate = z.infer<typeof UpdateTemplateSchema>
