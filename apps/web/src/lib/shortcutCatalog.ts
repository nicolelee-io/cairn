import type { Scope } from './shortcuts.ts'
import { asList, keyCaps } from './shortcutKeys.ts'

/**
 * What every keyboard shortcut is: its keys, group and label. This is static (not registered by
 * the screen that handles it) so the help dialog can list every shortcut from any screen. A screen
 * binds behaviour to an id with `useShortcuts([{ id: 'reader.edit', run }])`; the registry
 * (lib/shortcuts.ts) joins the two. Palette-only commands have no keys, so they live where they
 * are registered, not here.
 */
export interface Meta {
  /** One key sequence, or alternatives: "n", "g e", "Mod+S". See lib/shortcutKeys.ts. */
  keys?: string | string[]
  /** The help dialog's heading and the palette's group label. */
  group: string
  label: string
  /** Wins over a less specific scope when keys collide. Default global. */
  scope?: Scope
  /** A bare key that still works while the caret is in the entry editor (Esc). */
  inCodeEditor?: boolean
  /** Works while a dialog is open. */
  inDialog?: boolean
  /** Leave out of the command palette (it is listed in the help dialog only). */
  palette?: boolean
  /**
   * Handled by something other than the registry (CodeMirror's own keymap), so no screen registers
   * it. Listed in the help dialog beside its scope's other shortcuts, never in the palette.
   */
  helpOnly?: boolean
}

const editor = { group: 'Editor', scope: 'editor' } as const
const text = { group: 'Editor', scope: 'editor', helpOnly: true, palette: false } as const
const browse = { scope: 'browse' } as const
const reader = { group: 'Reader', scope: 'reader' } as const
const calendar = { group: 'Calendar', ...browse } as const

export const CATALOG = {
  // General
  help: { keys: ['?', 'Shift+/', 'Mod+/'], group: 'General', label: 'Show keyboard shortcuts' },
  palette: {
    keys: 'Mod+K',
    group: 'General',
    label: 'Command palette',
    palette: false,
  },
  back: { keys: 'Escape', group: 'General', label: 'Go back', palette: false },
  search: { keys: '/', group: 'General', label: 'Search' },
  'entry.new': { keys: 'n', group: 'General', label: 'New entry' },

  // Go to (the `g` chords, off unless Settings turns them on)
  'go.entries': { keys: 'g e', group: 'Go to', label: 'Entries' },
  'go.insights': { keys: 'g i', group: 'Go to', label: 'Insights' },
  'go.prompts': { keys: 'g p', group: 'Go to', label: 'Prompts' },
  'go.drafts': { keys: 'g d', group: 'Go to', label: 'Drafts' },
  'go.journals': { keys: 'g j', group: 'Go to', label: 'Manage journals' },
  'go.tags': { keys: 'g t', group: 'Go to', label: 'Manage tags' },
  'go.settings': { keys: 'g s', group: 'Go to', label: 'Settings' },
  'go.sync': { keys: 'g y', group: 'Go to', label: 'Offline & sync' },

  // The entry list
  'view.details': { keys: '1', group: 'Entries', label: 'Show Details', ...browse },
  'view.list': { keys: '2', group: 'Entries', label: 'Show List', ...browse },
  'view.calendar': { keys: '3', group: 'Entries', label: 'Show Calendar', ...browse },
  'view.media': { keys: '4', group: 'Entries', label: 'Show Media', ...browse },
  'view.map': { keys: '5', group: 'Entries', label: 'Show Map', ...browse },
  'journal.prev': { keys: '[', group: 'Entries', label: 'Previous journal', ...browse },
  'journal.next': { keys: ']', group: 'Entries', label: 'Next journal', ...browse },
  'list.next': { keys: 'j', group: 'Entries', label: 'Next entry in the list', ...browse },
  'list.prev': { keys: 'k', group: 'Entries', label: 'Previous entry in the list', ...browse },

  // The reader
  'reader.older': { keys: 'j', label: 'Older entry', ...reader },
  'reader.newer': { keys: 'k', label: 'Newer entry', ...reader },
  'reader.edit': { keys: 'e', label: 'Edit this entry', ...reader },
  'reader.pin': { keys: 'p', label: 'Pin or unpin this entry', ...reader },
  'reader.immersive': { keys: 'Alt+Shift+Z', label: 'Toggle zen mode', ...reader },
  'reader.star': { keys: 's', label: 'Star or unstar this entry', ...reader },

  // Calendars (the Calendar view and Insights)
  'calendar.next': {
    keys: 'ArrowRight',
    label: 'Next day with entries',
    palette: false,
    ...calendar,
  },
  'calendar.prev': {
    keys: 'ArrowLeft',
    label: 'Previous day with entries',
    palette: false,
    ...calendar,
  },
  'calendar.today': { keys: 't', label: 'Jump to this month', ...calendar },
  'calendar.month.prev': { keys: '[', label: 'Previous month', ...calendar },
  'calendar.month.next': { keys: ']', label: 'Next month', ...calendar },

  // Search results
  'search.next': { keys: 'j', group: 'Search', label: 'Next result', palette: false, ...browse },
  'search.prev': {
    keys: 'k',
    group: 'Search',
    label: 'Previous result',
    palette: false,
    ...browse,
  },

  // The editor
  'editor.save': { keys: 'Mod+S', label: 'Save', ...editor },
  'editor.saveClose': { keys: 'Mod+Shift+S', label: 'Save and close', ...editor },
  'editor.leave': {
    keys: 'Escape',
    label: 'Close the editor',
    inCodeEditor: true,
    palette: false,
    ...editor,
  },
  'editor.bold': { keys: 'Mod+B', label: 'Bold', ...editor },
  'editor.italic': { keys: 'Mod+I', label: 'Italic', ...editor },
  'editor.strike': { keys: 'Mod+Shift+X', label: 'Strikethrough', ...editor },
  'editor.link': { keys: 'Mod+L', label: 'Link', ...editor },
  'editor.h1': { keys: 'Mod+Alt+1', label: 'Heading 1', ...editor },
  'editor.h2': { keys: 'Mod+Alt+2', label: 'Heading 2', ...editor },
  'editor.h3': { keys: 'Mod+Alt+3', label: 'Heading 3', ...editor },
  'editor.bullets': { keys: 'Mod+Shift+8', label: 'Bulleted list', ...editor },
  'editor.numbers': { keys: 'Mod+Shift+7', label: 'Numbered list', ...editor },
  'editor.quote': { keys: 'Mod+Shift+9', label: 'Quote', ...editor },
  'editor.immersive': { keys: 'Alt+Shift+Z', label: 'Toggle zen mode', ...editor },
  'editor.date': { keys: 'Alt+Shift+D', label: 'Date and time', ...editor },
  'editor.place': { keys: 'Alt+Shift+L', label: 'Location', ...editor },
  'editor.mood': { keys: 'Alt+Shift+M', label: 'Mood', ...editor },
  'editor.tags': { keys: 'Alt+Shift+T', label: 'Tags', ...editor },
  'editor.weather': { keys: 'Alt+Shift+W', label: 'Weather', ...editor },
  'editor.journal': { keys: 'Alt+Shift+J', label: 'Change journal', ...editor },
  'editor.photos': { keys: 'Alt+Shift+P', label: 'Add photos', ...editor },
  'editor.files': { keys: 'Alt+Shift+F', label: 'Add files', ...editor },
  'editor.pin': { keys: 'Alt+Shift+N', label: 'Pin or unpin', ...editor },
  'editor.star': { keys: 'Alt+Shift+S', label: 'Star or unstar', ...editor },
  'editor.source': { keys: 'Alt+Shift+C', label: 'Show plain text (Markdown)', ...editor },

  // Text editing keys that CodeMirror's default keymap already handles (cm/MarkdownEditor.tsx).
  // Mod+L (Link), Mod+I (italic) and Mod+/ (help) are taken by the shortcuts above, so VS Code's
  // select line is Alt+L here.
  'text.undo': { keys: 'Mod+Z', label: 'Undo', ...text },
  'text.redo': { keys: ['Mod+Shift+Z', 'Mod+Y'], label: 'Redo', ...text },
  'text.moveLine': {
    keys: ['Alt+ArrowUp', 'Alt+ArrowDown'],
    label: 'Move line up or down',
    ...text,
  },
  'text.copyLine': {
    keys: ['Alt+Shift+ArrowUp', 'Alt+Shift+ArrowDown'],
    label: 'Copy line up or down',
    ...text,
  },
  'text.deleteLine': { keys: 'Mod+Shift+K', label: 'Delete line', ...text },
  'text.selectLine': { keys: 'Alt+L', label: 'Select line', ...text },
  'text.blankLine': { keys: 'Mod+Enter', label: 'Insert a blank line below', ...text },
  'text.indent': { keys: ['Mod+[', 'Mod+]'], label: 'Indent less or more', ...text },
  'text.cursors': {
    keys: ['Mod+Alt+ArrowUp', 'Mod+Alt+ArrowDown'],
    label: 'Add a cursor above or below',
    ...text,
  },
} satisfies Record<string, Meta>

export type CatalogId = keyof typeof CATALOG

/** A shortcut's first key sequence as text for a tooltip, e.g. "Alt+Shift+N" (⌘ and ⌥ on a Mac). */
export function shortcutHint(id: CatalogId): string {
  const meta: Meta = CATALOG[id]
  const first = meta.keys && asList(meta.keys)[0]
  return first
    ? keyCaps(first)
        .map((step) => step.join('+'))
        .join(' ')
    : ''
}
