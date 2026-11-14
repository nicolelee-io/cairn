import { defaultKeymap, history, historyKeymap, redo, undo } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { Annotation, Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap, placeholder as placeholderText } from '@codemirror/view'
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import type { Edit } from '../../../lib/markdownEdit.ts'
import { isAttachmentFile } from '../../../lib/upload.ts'
import { livePreview, photoHooks } from './livePreview.ts'
import { slashCommands, slashOpen } from './slashCommands.ts'
import type { InsertContext, InsertItem } from '../../../lib/insertItems.ts'

/** What the toolbar and the photo code can ask of the editor. */
export interface EditorHandle {
  focus(): void
  /** True once the user has put a caret in the text (a fresh editor reports position 0 otherwise). */
  hasCaret(): boolean
  /** The text and selection now, for building a menu (which heading level the caret is on). */
  read(): { value: string; from: number; to: number }
  /** Builds an edit from the current text and selection (the pure helpers in lib/markdownEdit). */
  edit(build: (value: string, start: number, end: number) => Edit): void
  undo(): void
  redo(): void
  /** True while the slash menu is open (Esc then closes just the menu). */
  completionOpen(): boolean
}

/** Marks changes that came from the `value` prop, so they aren't reported back as typing. */
const External = Annotation.define<boolean>()

const theme = EditorView.theme({
  // Fills the space down to the footer (the host is a flex column): CodeMirror only takes clicks
  // on its own content, so an editor as short as its text left a dead zone below it.
  '&': { flex: '1 1 auto', minHeight: '40dvh', color: 'inherit', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    font: 'inherit',
    lineHeight: 'inherit',
    overflow: 'visible',
    flexGrow: 1,
    // The base theme says flex-start !important; stretched, the content fills the scroller and a
    // click below the text lands in it.
    alignItems: 'stretch !important',
  },
  '.cm-content': { padding: '0 0 1.5rem', caretColor: 'var(--color-primary)' },
  '.cm-line': { padding: 0 },
  '.cm-cursor': { borderLeftColor: 'var(--color-primary)' },
  '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground':
    { background: 'color-mix(in srgb, var(--color-primary) 28%, transparent)' },
  '.cm-line::selection, .cm-line ::selection': {
    background: 'color-mix(in srgb, var(--color-primary) 35%, transparent)',
  },
  '.cm-placeholder': { color: 'var(--color-on-surface-variant)', opacity: 0.7 },
  // The slash menu, in the app's own colours (CodeMirror's default is a light grey box in
  // monospace). Every selector repeats `.cm-tooltip.cm-tooltip-autocomplete`, the base theme's
  // own, or its rules win on specificity.
  '.cm-tooltip.cm-tooltip-autocomplete': {
    border: 'none',
    borderRadius: '0.75rem',
    overflow: 'hidden',
    backgroundColor: 'var(--color-surface-container-high)',
    color: 'var(--color-on-surface)',
    boxShadow: '0 4px 16px color-mix(in srgb, black 25%, transparent)',
    // An inset all round, so the scrollbar's track ends clear of the rounded corners.
    padding: '0.25rem',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': {
    maxHeight: '16rem',
    fontFamily: 'var(--font-sans)',
    fontSize: '0.9375rem',
    // Reaching the end of the list never scrolls the page behind it. (Its scrollbar is in
    // index.css: CodeMirror's theme can't carry the ::-webkit-scrollbar rules or the @supports.)
    overscrollBehavior: 'contain',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
    padding: '0.5rem 0.75rem',
    lineHeight: '1.25rem',
    borderRadius: '0.5rem',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--color-secondary-container)',
    color: 'var(--color-on-secondary-container)',
  },
  '.cm-tooltip.cm-tooltip-autocomplete .cm-completionDetail': {
    marginLeft: '0.75rem',
    fontStyle: 'normal',
    opacity: 0.7,
  },
  // A group's heading is a `completion-section` element (not a classed li).
  '.cm-tooltip.cm-tooltip-autocomplete > ul > completion-section': {
    padding: '0.5rem 0.75rem 0.25rem',
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: 'var(--color-on-surface-variant)',
    border: 'none',
    opacity: 1,
  },
})

/**
 * The entry text editor: CodeMirror 6 over plain markdown. It is controlled like a textarea
 * (`value` / `onChange`) so the entry editor's drafts, dirty tracking and save logic don't care what
 * is underneath.
 */
export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  autoFocus,
  caretAtEnd,
  bottomMargin = 0,
  source = false,
  onOpenPhoto,
  onFiles,
  onFocusChange,
  slash,
  handle,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  autoFocus?: boolean
  /** Start with the caret after the last character instead of at the top (a new entry seeded with a prompt heading). */
  caretAtEnd?: boolean
  /** Px at the bottom of the screen that something else covers (the phone toolbar). */
  bottomMargin?: number
  /** Plain markdown, nothing styled or rendered in place. */
  source?: boolean
  onOpenPhoto: (id: string) => void
  /** Images pasted or dropped into the text. */
  onFiles: (files: File[]) => void
  onFocusChange?: (focused: boolean) => void
  /** What `/` offers, and the entry's timezone for the date inserts; the moment is read on use. */
  slash: { items: InsertItem[]; timezone: string }
  handle: Ref<EditorHandle>
}) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const placed = useRef(false)
  // Texts reported through onChange that `value` hasn't caught up with yet (see the sync below).
  const reported = useRef<string[]>([])
  // The extensions are built once; they reach the latest props through this.
  const live = useRef(new Compartment())
  const props = useRef({ onChange, onFiles, onFocusChange, bottomMargin, onOpenPhoto, slash })
  useEffect(() => {
    props.current = { onChange, onFiles, onFocusChange, bottomMargin, onOpenPhoto, slash }
  })

  useEffect(() => {
    // Photos and the attachment types; plain text pastes stay text.
    const media = (files: FileList | null | undefined) =>
      [...(files ?? [])].filter((f) => f.type.startsWith('image/') || isAttachmentFile(f))
    const v = new EditorView({
      parent: host.current ?? undefined,
      state: EditorState.create({
        doc: value,
        selection: caretAtEnd ? { anchor: value.length } : undefined,
        extensions: [
          history(),
          slashCommands({
            items: () => props.current.slash.items,
            context: (): InsertContext => ({
              now: Date.now(),
              timezone: props.current.slash.timezone,
            }),
          }),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          markdown({ base: markdownLanguage }),
          EditorView.lineWrapping,
          placeholderText(placeholder ?? ''),
          // CodeMirror defaults these off (it is built for code). Without `autocorrect` Gboard only
          // suggests and never replaces on space, and CodeMirror undoes the double-space period.
          EditorView.contentAttributes.of({
            'aria-label': 'Entry text',
            'aria-multiline': 'true',
            spellcheck: 'true',
            autocorrect: 'on',
            autocapitalize: 'sentences',
          }),
          // Keeps the caret clear of the toolbar that sits over the bottom of the screen.
          EditorView.scrollMargins.of(() => ({ bottom: props.current.bottomMargin })),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !u.transactions.some((t) => t.annotation(External))) {
              const doc = u.state.doc.toString()
              reported.current.push(doc)
              props.current.onChange(doc)
            }
            if (u.focusChanged) {
              if (u.view.hasFocus) placed.current = true
              props.current.onFocusChange?.(u.view.hasFocus)
            }
          }),
          EditorView.domEventHandlers({
            paste(e) {
              const files = media(e.clipboardData?.files)
              if (!files.length) return false
              props.current.onFiles(files)
              return true
            },
            // Without this CodeMirror would read a dropped file as text.
            drop(e) {
              if (!e.dataTransfer?.files.length) return false
              props.current.onFiles(media(e.dataTransfer.files))
              return true
            },
          }),
          photoHooks.of({ open: (id) => props.current.onOpenPhoto(id) }),
          live.current.of(source ? [] : livePreview),
          theme,
        ],
      }),
    })
    view.current = v
    if (autoFocus) v.focus()
    return () => {
      v.destroy()
      view.current = null
    }
    // The editor is created once; later changes to `value` are synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    view.current?.dispatch({ effects: live.current.reconfigure(source ? [] : livePreview) })
  }, [source])

  // Text changed from outside (discard draft, "use theirs", a photo added or removed in the strip).
  // A `value` we reported ourselves is only the parent catching up, even when it is behind the
  // doc: typing faster than React renders would otherwise reset the doc to it and drop keystrokes.
  useEffect(() => {
    const v = view.current
    const ours = reported.current.indexOf(value)
    if (ours >= 0) {
      reported.current.splice(0, ours + 1)
      return
    }
    reported.current = []
    if (!v || v.state.doc.toString() === value) return
    v.dispatch({
      changes: { from: 0, to: v.state.doc.length, insert: value },
      annotations: External.of(true),
    })
  }, [value])

  useImperativeHandle(handle, () => ({
    focus: () => view.current?.focus(),
    hasCaret: () => placed.current,
    read() {
      const v = view.current
      if (!v) return { value: '', from: 0, to: 0 }
      const { from, to } = v.state.selection.main
      return { value: v.state.doc.toString(), from, to }
    },
    edit(build) {
      const v = view.current
      if (!v) return
      const { from, to } = v.state.selection.main
      const e = build(v.state.doc.toString(), from, to)
      v.dispatch({
        changes: { from: e.from, to: e.to, insert: e.insert },
        selection: { anchor: e.selStart, head: e.selEnd },
        scrollIntoView: true,
        userEvent: 'input',
      })
      v.focus()
    },
    undo() {
      const v = view.current
      if (!v) return
      v.focus()
      undo(v)
    },
    redo() {
      const v = view.current
      if (!v) return
      v.focus()
      redo(v)
    },
    completionOpen: () => !!view.current && slashOpen(view.current),
  }))

  return (
    <div
      ref={host}
      className="flex flex-1 flex-col font-entry leading-relaxed"
      style={{ fontSize: 'calc(1.125rem * var(--entry-scale, 1))' }}
    />
  )
}
