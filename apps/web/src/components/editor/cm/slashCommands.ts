import {
  acceptCompletion,
  autocompletion,
  completionStatus,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete'
import { Prec } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { matchItems, type InsertContext, type InsertItem } from '../../../lib/insertItems.ts'
import { diffEdit } from '../../../lib/markdownEdit.ts'

/** What the slash menu reads each time it opens; the editor keeps these current. */
export interface SlashSource {
  items(): InsertItem[]
  context(): InsertContext
}

/**
 * Applies `item` in place of the `/query` that runs from `slash` to `to`, as one change (one undo
 * step): the item is built on the text with the query already gone, and the difference between
 * that and the real text is what gets dispatched.
 */
export function applySlash(
  view: EditorView,
  item: InsertItem,
  slash: number,
  to: number,
  ctx: InsertContext,
) {
  const value = view.state.doc.toString()
  const without = value.slice(0, slash) + value.slice(to)
  const e = item.build(without, slash, slash, ctx)
  const after = without.slice(0, e.from) + e.insert + without.slice(e.to)
  const change = diffEdit(value, after)
  view.dispatch({
    changes: change,
    selection: { anchor: e.selStart, head: e.selEnd },
    scrollIntoView: true,
    userEvent: 'input.complete',
  })
}

/**
 * Typing `/` at the start of a line or after a space lists the inserts; the rest of the word
 * filters them. Not inside a word, so `and/or` and addresses never open it.
 */
function complete(src: SlashSource) {
  return (cc: CompletionContext): CompletionResult | null => {
    // A word, then more words after spaces (template names have them: "/daily log"). Nothing may
    // follow the slash at once but a word, so "yes / no" never opens it.
    const m = cc.matchBefore(/\/(?:[\p{L}\p{N}_-]+(?: [\p{L}\p{N}_-]*){0,5})?$/u)
    if (!m) return null
    const before = m.from === 0 ? '' : cc.state.doc.sliceString(m.from - 1, m.from)
    if (before !== '' && !/\s/.test(before)) return null
    const ctx = src.context()
    const found = matchItems(src.items(), m.text.slice(1))
    if (found.length === 0) return null
    // CodeMirror orders sections by name unless they carry a rank: keep the list's own order
    // (the user's templates, then the dates, then the formats).
    const groups = [...new Set(found.map((i) => i.group))]
    const options: Completion[] = found.map((item) => ({
      label: item.label,
      detail: item.preview?.(ctx) ?? undefined,
      section: { name: item.group, rank: groups.indexOf(item.group) },
      type: 'text',
      apply: (view, _c, _from, to) => applySlash(view, item, m.from, to, ctx),
    }))
    // `filter: false`: matchItems already chose and ordered them; CodeMirror's own fuzzy match
    // would match against the label alone and drop the keyword hits.
    return { from: m.from, options, filter: false }
  }
}

/** The slash menu: the completion source, its look, and Tab to pick (Enter is CodeMirror's own). */
export function slashCommands(src: SlashSource) {
  return [
    autocompletion({
      override: [complete(src)],
      icons: false,
      // A new line's `/` shouldn't have to be followed by a pause; typing opens it at once.
      activateOnTyping: true,
      closeOnBlur: true,
    }),
    // Tab leaves the text for the chips below it, as in Day One, except while this menu is open.
    Prec.highest(keymap.of([{ key: 'Tab', run: acceptCompletion }])),
  ]
}

/** True while the menu is showing (the editor's Esc must then close just the menu). */
export const slashOpen = (view: EditorView) => completionStatus(view.state) === 'active'
