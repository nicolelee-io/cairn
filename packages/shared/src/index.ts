import { z } from 'zod'

export * from './auth.ts'
export * from './entryCard.ts'
export * from './entryText.ts'
export * from './plainText.ts'
export * from './api.ts'
export * from './ids.ts'
export * from './journalIcons.ts'
export * from './mood.ts'
export * from './insights.ts'
export * from './mediaRefs.ts'
export * from './prompts.ts'
export * from './templates.ts'
export * from './storage.ts'
export * from './health.ts'
export * from './import.ts'
export * from './trash.ts'
export * from './weather.ts'

export const HealthSchema = z.object({
  status: z.literal('ok'),
  sha: z.string(),
  /** ISO time the image was built; null for a dev run. */
  builtAt: z.string().nullable(),
})
export type Health = z.infer<typeof HealthSchema>
