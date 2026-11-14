import { z } from 'zod'

// Server alerts: the admin points Cairn at an ntfy topic and it pushes a message when the server
// itself is unwell (a failed or missed backup, a database it can't write to).
// There are no per-alert switches: on means all of them. Never anything from a user's journals.

export const DEFAULT_NTFY_URL = 'https://ntfy.sh'

/** ntfy topics are 1-64 letters, digits, `_` or `-`; on a public server the name is the only secret. */
export const NtfyTopicSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, 'letters, digits, _ and - only, up to 64')

export const NtfyUrlSchema = z
  .string()
  .trim()
  .max(200)
  .url()
  .refine((u) => /^https?:\/\//i.test(u), 'http or https')

/** GET /api/admin/notifications. The access token is never sent back, only whether one is set. */
export const NotifySettingsSchema = z.object({
  enabled: z.boolean(),
  url: z.string(),
  topic: z.string(),
  hasToken: z.boolean(),
})
export type NotifySettings = z.infer<typeof NotifySettingsSchema>

/** PUT body. `token`: absent keeps the saved one, an empty string removes it. */
export const UpdateNotifySettingsSchema = z
  .object({
    enabled: z.boolean(),
    url: NtfyUrlSchema,
    topic: NtfyTopicSchema.or(z.literal('')),
    token: z.string().trim().max(200).optional(),
  })
  .refine((s) => !s.enabled || s.topic !== '', { message: 'a topic is needed to turn alerts on' })
export type UpdateNotifySettings = z.infer<typeof UpdateNotifySettingsSchema>

/** POST /api/admin/notifications/test. */
export const NotifyTestResultSchema = z.object({
  ok: z.boolean(),
  /** Why it failed, in a few words (never the token). */
  error: z.string().nullable(),
})
export type NotifyTestResult = z.infer<typeof NotifyTestResultSchema>

export const HEALTH_PROBLEMS = ['backup', 'database'] as const
export type HealthProblemId = (typeof HEALTH_PROBLEMS)[number]

/**
 * GET /api/admin/health: what the alerts watch, live. Free disk space is left out on purpose:
 * under Docker Desktop/WSL2 the container sees the virtual disk's maximum, not the host drive.
 */
export const ServerHealthSchema = z.object({
  /** One entry per thing wrong right now; empty when all is well. */
  problems: z.array(z.object({ id: z.enum(HEALTH_PROBLEMS), message: z.string() })),
  databaseWritable: z.boolean(),
  checkedAt: z.number(),
})
export type ServerHealth = z.infer<typeof ServerHealthSchema>
