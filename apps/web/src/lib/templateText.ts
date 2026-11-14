import {
  TEMPLATE_NAME_MAX_LENGTH,
  attachmentRefs,
  photoRefs,
  stripAttachmentRef,
  stripPhotoRef,
  summarize,
  type Template,
} from '@cairn/shared'
import { numericDate, timeLabel, weekdayName } from './format.ts'
import { dateAndTime, type InsertContext, type InsertItem } from './insertItems.ts'
import { insertSnippet } from './markdownEdit.ts'

// The pure side of entry templates (the hooks are in lib/templates.ts): placeholders and the inserts.

/** The placeholders a template can hold, as the manage dialog lists them. */
export const PLACEHOLDERS = [
  {
    token: '{{date}}',
    label: 'Date',
    example: (c: InsertContext) => numericDate(c.now, c.timezone),
  },
  { token: '{{time}}', label: 'Time', example: (c: InsertContext) => timeLabel(c.now, c.timezone) },
  { token: '{{datetime}}', label: 'Date and time', example: dateAndTime },
  {
    token: '{{weekday}}',
    label: 'Weekday',
    example: (c: InsertContext) => weekdayName(c.now, c.timezone),
  },
] as const

/**
 * A template's text as it goes into an entry: each `{{date}}`, `{{time}}`, `{{datetime}}` and
 * `{{weekday}}` becomes the current moment on the clock of the entry's timezone (what the slash
 * date commands do too). The name is case-insensitive and may have spaces inside the braces; any
 * other `{{word}}` stays as typed, so a mistyped one shows and nothing is silently dropped.
 */
export function expandTemplate(body: string, ctx: InsertContext): string {
  const values = new Map(PLACEHOLDERS.map((p) => [p.token.slice(2, -2), p.example(ctx)]))
  return body.replace(
    /\{\{\s*([A-Za-z]+)\s*\}\}/g,
    (whole, name: string) => values.get(name.toLowerCase()) ?? whole,
  )
}

/**
 * An entry's text for saving as a template: templates are text only, so every photo and file
 * reference goes (a reference alone on its line takes the line, and the blank line it leaves, with it).
 */
export function withoutMedia(body: string): string {
  let out = body
  for (const id of photoRefs(out)) out = stripPhotoRef(out, id)
  for (const id of attachmentRefs(out)) out = stripAttachmentRef(out, id)
  return out
}

/** The name offered when an entry is saved as a template: its title, clipped to the name limit. */
export const suggestedName = (body: string) =>
  summarize(body).title.slice(0, TEMPLATE_NAME_MAX_LENGTH).trim()

/** The templates as inserts, for the slash menu (and the editor's header menu). */
export const templateItems = (list: readonly Template[]): InsertItem[] =>
  list.map((t) => ({
    id: `template:${t.id}`,
    label: t.name,
    group: 'Templates',
    keywords: ['template'],
    // A block is set apart from the text around it (insertSnippet), so a template put at the top of
    // an entry doesn't glue onto the title below it.
    build: (value, start, end, ctx) =>
      insertSnippet(value, start, end, expandTemplate(t.bodyMd, ctx)),
  }))
