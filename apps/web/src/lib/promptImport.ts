import {
  PromptImportFileSchema,
  type PromptImportFile,
  type PromptImportSummary,
} from '@cairn/shared'
import { plural } from './format.ts'

/** "2 new categories, 41 new prompts, 6 already there, 1 unknown icon (the default is used)". */
export function describeImport(s: PromptImportSummary): string {
  if (s.newCategories === 0 && s.newPrompts === 0) return 'Nothing new: it is all there already.'
  const parts = [
    s.newCategories > 0 && plural(s.newCategories, 'new category', 'new categories'),
    s.newPrompts > 0 && plural(s.newPrompts, 'new prompt', 'new prompts'),
    s.existingPrompts > 0 && `${s.existingPrompts} already there`,
    s.unknownIcons > 0 &&
      `${plural(s.unknownIcons, 'unknown icon', 'unknown icons')} (the default is used)`,
  ]
  return parts.filter(Boolean).join(', ')
}

/** Reads the pasted or chosen text as an import file; the first problem is the message. */
export function parseImport(
  text: string,
): { ok: true; file: PromptImportFile } | { ok: false; error: string } {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, error: 'That isn’t valid JSON.' }
  }
  const parsed = PromptImportFileSchema.safeParse(json)
  if (parsed.success) return { ok: true, file: parsed.data }
  const issue = parsed.error.issues[0]
  const where = issue?.path.length ? ` (at ${issue.path.join(' › ')})` : ''
  return { ok: false, error: `That doesn’t look like a prompts file${where}: ${issue?.message}.` }
}
