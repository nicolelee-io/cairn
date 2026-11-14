import { syntaxTree } from '@codemirror/language'
import { EditorState, Facet, Prec, StateEffect, StateField, type Range } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  keymap,
  showTooltip,
  WidgetType,
  type DecorationSet,
  type Tooltip,
} from '@codemirror/view'
import { diffEdit, moveBlock } from '../../../lib/markdownEdit.ts'
import { externalHref } from '../../../lib/externalHref.ts'
import { photoUrl } from '../../../lib/photos.ts'
import { stripAttachmentRef, stripPhotoRef } from '@cairn/shared'
import { iconSvg, type IconName } from '../../Icon.tsx'

/** What the photo widgets need from the page around the editor. */
export interface PhotoHooks {
  open(id: string): void
}
export const photoHooks = Facet.define<PhotoHooks, PhotoHooks>({
  combine: (v) => v[0] ?? { open: () => {} },
})

/**
 * A photo or attachment reference alone on its line: the only form the editor itself inserts.
 * Groups: the alt text (an attachment's file name), the scheme, the id.
 */
const MEDIA_LINE = /^!\[([^\]]*)\]\((photo|attachment):([\w-]+)\)\s*$/
type Scheme = 'photo' | 'attachment'

const line = (cls: string) => Decoration.line({ class: cls })
const hide = Decoration.replace({})
const mark = (cls: string) => Decoration.mark({ class: cls })

// ---- Selected photo or attachment ----
// Selecting a photo (to show its buttons) is state of its own, not a text selection: a selected
// range would be replaced by whatever is typed next. It lasts until the caret moves or the text
// changes, and holds the start of the photo's line.

const selectPhoto = StateEffect.define<number | null>()
const selectedPhoto = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(selectPhoto)) return e.value
    return tr.selection || tr.docChanged ? null : value
  },
})

// ---- Photo and attachment widgets ----

const BTN =
  'state-layer grid size-9 cursor-pointer place-items-center rounded-full bg-surface-container-highest text-on-surface shadow-md'

/** The attachment's icon, guessed from its file name (the widget only has the text to go on). */
function fileIcon(name: string): IconName {
  if (/\.pdf$/i.test(name)) return 'picture_as_pdf'
  if (/\.(mp4|mov)$/i.test(name)) return 'video_file'
  if (/\.m4a$/i.test(name)) return 'audio_file'
  return 'attach_file'
}

/** The tappable part: the picture, or a chip with the attachment's icon and name. */
function mediaFace(view: EditorView, scheme: Scheme, id: string, name: string): HTMLElement {
  if (scheme === 'photo') {
    const img = document.createElement('img')
    img.src = photoUrl(id, 'display')
    img.alt = ''
    img.draggable = false
    img.className =
      'mx-auto block max-h-[30dvh] max-w-full rounded-lg bg-surface-container object-contain medium:max-h-[50dvh]'
    // A late-loading image changes the line's height; tell CodeMirror to re-measure.
    img.onload = () => view.requestMeasure()
    return img
  }
  const chip = document.createElement('span')
  chip.dataset.media = ''
  chip.setAttribute('role', 'button') // named by its text: the file's name
  chip.className =
    'flex max-w-full cursor-pointer items-center gap-2 rounded-xl bg-surface-container-low px-3 py-2 font-sans text-sm'
  chip.innerHTML = iconSvg(fileIcon(name))
  chip.querySelector('svg')?.setAttribute('class', 'size-5 shrink-0 fill-current text-primary')
  const label = document.createElement('span')
  label.className = 'truncate'
  label.textContent = name || 'Attachment'
  chip.append(label)
  return chip
}

class MediaWidget extends WidgetType {
  constructor(
    readonly scheme: Scheme,
    readonly id: string,
    readonly name: string,
    readonly selected: boolean,
  ) {
    super()
  }

  override eq(o: MediaWidget) {
    return (
      o.scheme === this.scheme &&
      o.id === this.id &&
      o.name === this.name &&
      o.selected === this.selected
    )
  }

  private open(view: EditorView) {
    if (this.scheme === 'photo') view.state.facet(photoHooks).open(this.id)
    else window.open(`/api/attachments/${this.id}`, '_blank', 'noopener')
  }

  override toDOM(view: EditorView) {
    const box = document.createElement('div')
    box.className = 'cm-photo relative my-3 w-fit max-w-full'
    // Tapping must not move focus: that would open (or close) the phone keyboard, which resizes the
    // page and scrolls the buttons away. The click still arrives.
    box.onpointerdown = (e) => {
      if (e.target instanceof Element && e.target.closest('img, button, [data-media]'))
        e.preventDefault()
    }
    const face = mediaFace(view, this.scheme, this.id, this.name)
    box.append(face)
    const noun = this.scheme === 'photo' ? 'photo' : 'file'
    if (this.selected) {
      face.classList.add('ring-2', 'ring-primary')
      const bar = document.createElement('div')
      // Under the picture, not over it: a photo shrunk by the keyboard can be narrower than the row.
      bar.className = 'mt-2 flex gap-1'
      const add = (icon: IconName, label: string, run: () => void) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = BTN
        b.ariaLabel = label
        b.title = label
        b.innerHTML = iconSvg(icon)
        b.querySelector('svg')?.setAttribute('class', 'size-5 fill-current')
        b.dataset.photoBtn = ''
        b.onclick = () => withoutKeyboard(view, run)
        bar.append(b)
      }
      add('keyboard_arrow_up', 'Move up', () => move(view, box, -1))
      add('keyboard_arrow_down', 'Move down', () => move(view, box, 1))
      add('open_in_new', `View ${noun}`, () => this.open(view))
      add('delete', `Remove ${noun}`, () => remove(view, this.scheme, this.id))
      box.append(bar)
    }
    face.onclick = () => {
      const { from } = rangeOf(view, box)
      // The first tap selects it (and shows its buttons); a tap on a selected one opens it.
      if (this.selected) this.open(view)
      else view.dispatch({ effects: selectPhoto.of(from) })
    }
    return box
  }

  // Taps on the picture or chip and its buttons are ours; a tap anywhere else around it is the
  // editor's, so it moves the caret (and deselects) like a tap beside any other line.
  override ignoreEvent(e: Event) {
    return e.target instanceof Element && !!e.target.closest('img, button, [data-media]')
  }
}

function rangeOf(view: EditorView, dom: HTMLElement) {
  const l = view.state.doc.lineAt(view.posAtDOM(dom))
  return { from: l.from, to: l.to }
}

/**
 * Runs a button's action, and if the editor wasn't focused before, makes sure it isn't afterwards:
 * rewriting the text under a finger can make Android focus the editor, which opens the keyboard
 * for what was only a tap on a photo's button.
 */
function withoutKeyboard(view: EditorView, run: () => void) {
  const had = view.hasFocus
  run()
  if (had) return
  const release = () => view.hasFocus && view.contentDOM.blur()
  release()
  requestAnimationFrame(release)
}

function move(view: EditorView, dom: HTMLElement, dir: -1 | 1) {
  const e = moveBlock(view.state.doc.toString(), view.posAtDOM(dom), dir)
  if (!e) return
  view.dispatch({
    changes: { from: e.from, to: e.to, insert: e.insert },
    effects: selectPhoto.of(e.selStart), // the photo stays selected where it lands
    scrollIntoView: true,
    userEvent: 'move',
  })
}

function remove(view: EditorView, scheme: Scheme, id: string) {
  const before = view.state.doc.toString()
  const after = scheme === 'photo' ? stripPhotoRef(before, id) : stripAttachmentRef(before, id)
  view.dispatch({ changes: diffEdit(before, after), userEvent: 'delete' })
}

/** Backspace or Delete with a photo or attachment selected removes it, like any selected object. */
const removeSelected = (view: EditorView) => {
  const at = view.state.field(selectedPhoto)
  if (at === null) return false
  const m = MEDIA_LINE.exec(view.state.doc.lineAt(at).text)
  if (!m) return false
  remove(view, m[2] as Scheme, m[3]!)
  return true
}

// ---- Checklist boxes ----

/** A task item's `- [ ] ` drawn as a checkbox that a tap ticks (the text stays `- [ ] `). */
class TaskBox extends WidgetType {
  constructor(readonly checked: boolean) {
    super()
  }
  override eq(other: TaskBox) {
    return other.checked === this.checked
  }
  toDOM(view: EditorView) {
    const box = document.createElement('span')
    box.setAttribute('role', 'checkbox')
    box.setAttribute('aria-checked', String(this.checked))
    box.className = `cm-taskbox${this.checked ? ' cm-taskbox-on' : ''}`
    box.innerHTML = this.checked ? iconSvg('check') : ''
    box.querySelector('svg')?.setAttribute('class', 'size-3.5 fill-current')
    // Mouse-down, not click: the caret must stay where it is (and the on-screen keyboard up).
    box.onmousedown = (e) => {
      e.preventDefault()
      // The widget stands for `- [ ] ` (the bullet, the box and its space): find the box in it.
      const at = view.posAtDOM(box)
      const l = view.state.doc.lineAt(at)
      const m = /^\s*[-*+] \[([ xX])\]/.exec(l.text)
      if (!m) return
      const inner = l.from + m[0].length - 2
      view.dispatch({
        changes: { from: inner, to: inner + 1, insert: m[1] === ' ' ? 'x' : ' ' },
        userEvent: 'input',
      })
    }
    return box
  }
  override ignoreEvent() {
    return true
  }
}

/**
 * The checkboxes: each task item's bullet, box and the space after it become one widget. They sit in
 * a field of their own so the same set can be atomic (the caret skips the hidden text, and Backspace
 * right after a box takes the whole marker off, turning the item into plain text).
 */
function taskBoxes(state: EditorState): DecorationSet {
  const out: Range<Decoration>[] = []
  const doc = state.doc
  syntaxTree(state).iterate({
    enter(n) {
      if (n.name !== 'TaskMarker') return
      const l = doc.lineAt(n.from)
      const lead = /^(\s*)[-*+] $/.exec(doc.sliceString(l.from, n.from))
      if (!lead) return
      const start = l.from + lead[1]!.length
      const end = doc.sliceString(n.to, n.to + 1) === ' ' ? n.to + 1 : n.to
      const ticked = /[xX]/.test(doc.sliceString(n.from + 1, n.to - 1))
      out.push(Decoration.replace({ widget: new TaskBox(ticked) }).range(start, end))
    },
  })
  return Decoration.set(out, true)
}

const taskField = StateField.define<DecorationSet>({
  create: taskBoxes,
  update: (deco, tr) => (tr.docChanged || tr.reconfigured ? taskBoxes(tr.state) : deco),
  provide: (f) => [
    EditorView.decorations.from(f),
    EditorView.atomicRanges.of((v) => v.state.field(f)),
  ],
})

// ---- Links ----

type SyntaxNode = NonNullable<ReturnType<ReturnType<typeof syntaxTree>['resolveInner']>>

/** The address of the link or autolink under `pos`, or null. */
function linkAt(state: EditorState, pos: number): string | null {
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 0); n; n = n.parent) {
    if (n.name === 'URL') return state.sliceDoc(n.from, n.to)
    if (n.name === 'Link') {
      const url = n.getChild('URL')
      return url ? state.sliceDoc(url.from, url.to) : null
    }
  }
  return null
}

/** Opens a link's address in a new tab; false when there is nothing safe to open. */
function openAddress(address: string | null | undefined): boolean {
  const href = externalHref(address?.trim())
  if (!href || /^(javascript|data|vbscript):/i.test(href)) return false
  window.open(href, '_blank', 'noopener,noreferrer')
  return true
}

/** Ctrl/Cmd+click opens a link or autolink in a new tab, as in the reader (a plain click edits). */
const openLinks = EditorView.domEventHandlers({
  click(e, view) {
    if (!(e.ctrlKey || e.metaKey) || e.button !== 0) return false
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
    if (pos === null || !openAddress(linkAt(view.state, pos))) return false
    e.preventDefault()
    return true
  },
})

/** Half the width of the Open link pill (about 96px), to centre it under the caret. */
const PILL_HALF_WIDTH = 48

/**
 * Touch has no Ctrl+click, so while the caret sits in a link (or autolink) a small "Open link" pill
 * hangs below it (on every screen: it is handy with a mouse too). The button never takes focus, so the caret and keyboard stay put.
 */
function linkTip(state: EditorState): Tooltip | null {
  const sel = state.selection.main
  if (!sel.empty) return null
  const address = linkAt(state, sel.head)
  if (!address) return null
  return {
    pos: sel.head,
    create: () => {
      const dom = document.createElement('div')
      dom.className = 'cm-link-tip'
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = 'Open link'
      // Keep focus (and the keyboard) in the text; the open happens on click.
      button.addEventListener('pointerdown', (e) => e.preventDefault())
      button.addEventListener('click', () => {
        const at = linkAt(state, sel.head)
        openAddress(at)
      })
      dom.append(button)
      // CodeMirror puts a tooltip's left edge at the caret; half the pill's width centres it (and
      // CodeMirror still keeps it inside the editor at the edges).
      return { dom, offset: { x: -PILL_HALF_WIDTH, y: 0 } }
    },
  }
}

const linkTipField = StateField.define<Tooltip | null>({
  create: linkTip,
  update: (value, tr) => (tr.docChanged || tr.selection ? linkTip(tr.state) : value),
  provide: (f) => showTooltip.from(f),
})

// ---- Decorations ----

const touches = (state: EditorState, from: number, to: number) =>
  state.selection.ranges.some((r) => r.from <= to && r.to >= from)

/** Hides a marker (and the space after it) unless the caret is inside the thing it belongs to. */
function build(state: EditorState): DecorationSet {
  const out: Range<Decoration>[] = []
  const doc = state.doc
  const lineTouched = (pos: number) => {
    const l = doc.lineAt(pos)
    return touches(state, l.from, l.to)
  }
  const hideMark = (from: number, to: number, withSpace: boolean) => {
    const end = withSpace && doc.sliceString(to, to + 1) === ' ' ? to + 1 : to
    if (end > from) out.push(hide.range(from, end))
  }

  syntaxTree(state).iterate({
    enter(n) {
      const name = n.name
      const heading = /^ATXHeading([1-6])$/.exec(name)
      if (heading) {
        out.push(line(`cm-h cm-h${heading[1]}`).range(doc.lineAt(n.from).from))
      } else if (name === 'HeaderMark') {
        if (!lineTouched(n.from)) hideMark(n.from, n.to, true)
      } else if (name === 'StrongEmphasis') {
        out.push(mark('cm-strong').range(n.from, n.to))
      } else if (name === 'Emphasis') {
        out.push(mark('cm-em').range(n.from, n.to))
      } else if (name === 'Strikethrough') {
        out.push(mark('cm-strike').range(n.from, n.to))
      } else if (name === 'HorizontalRule') {
        // A rule is drawn as a line; the caret on it shows the raw marker again.
        out.push(
          line(lineTouched(n.from) ? 'cm-hr cm-hr-raw' : 'cm-hr').range(doc.lineAt(n.from).from),
        )
      } else if (name === 'InlineCode') {
        out.push(mark('cm-code').range(n.from, n.to))
      } else if (name === 'FencedCode' || name === 'CodeBlock') {
        for (let p = doc.lineAt(n.from).number; p <= doc.lineAt(n.to).number; p++)
          out.push(line('cm-codeblock').range(doc.line(p).from))
      } else if (name === 'Blockquote') {
        for (let p = doc.lineAt(n.from).number; p <= doc.lineAt(n.to).number; p++)
          out.push(line('cm-quote').range(doc.line(p).from))
      } else if (name === 'QuoteMark') {
        if (!lineTouched(n.from)) hideMark(n.from, n.to, true)
      } else if (name === 'Table') {
        // A pipe table stays plain text (no grid to edit), but is set apart: monospace so the pipes
        // line up as far as the writer padded them, a bold header and a quiet divider row.
        const first = doc.lineAt(n.from).number
        for (let p = first; p <= doc.lineAt(n.to).number; p++) {
          const cls = p === first ? ' cm-table-head' : p === first + 1 ? ' cm-table-divider' : ''
          out.push(line(`cm-table${cls}`).range(doc.line(p).from))
        }
      } else if (name === 'TableDelimiter') {
        if (n.to - n.from === 1) out.push(mark('cm-table-pipe').range(n.from, n.to))
      } else if (name === 'ListMark') {
        out.push(mark('cm-listmark').range(n.from, n.to))
      } else if (name === 'Link') {
        out.push(mark('cm-link').range(n.from, n.to))
      } else if (name === 'LinkMark' || name === 'URL' || name === 'LinkTitle') {
        const parent = n.node.parent
        if (name === 'URL' && parent?.name !== 'Link' && parent?.name !== 'Image') {
          // A bare address (`https://…`, `www.…`) is a link as typed.
          out.push(mark('cm-link').range(n.from, n.to))
        } else if (parent?.name === 'Link' && !touches(state, parent.from, parent.to))
          hideMark(n.from, n.to, false)
      } else if (name === 'EmphasisMark' || name === 'StrikethroughMark') {
        const parent = n.node.parent
        if (parent && !touches(state, parent.from, parent.to)) hideMark(n.from, n.to, false)
      }
    },
  })

  for (let p = 1; p <= doc.lines; p++) {
    const l = doc.line(p)
    const m = l.length > 12 ? MEDIA_LINE.exec(l.text) : null
    if (!m) continue
    const selected = state.field(selectedPhoto) === l.from
    const widget = new MediaWidget(m[2] as Scheme, m[3]!, m[1]!, selected)
    out.push(Decoration.replace({ widget, block: true }).range(l.from, l.to))
  }
  return Decoration.set(out, true)
}

const field = StateField.define<DecorationSet>({
  create: build,
  update: (deco, tr) =>
    tr.docChanged || tr.selection || tr.reconfigured || tr.effects.length ? build(tr.state) : deco,
  provide: (f) => EditorView.decorations.from(f),
})

const styles = EditorView.baseTheme({
  '.cm-h': { fontFamily: 'var(--font-sans)', fontWeight: 500, lineHeight: 1.3 },
  '.cm-h1': { fontSize: '1.3333em' },
  '.cm-h2': { fontSize: '1.1111em' },
  '.cm-h3, .cm-h4, .cm-h5, .cm-h6': { fontSize: '1em' },
  '.cm-strong': { fontWeight: 700 },
  '.cm-em': { fontStyle: 'italic' },
  '.cm-strike': { textDecoration: 'line-through' },
  '.cm-hr': { position: 'relative' },
  '.cm-hr:not(.cm-hr-raw)': { color: 'transparent' },
  '.cm-hr:not(.cm-hr-raw)::after': {
    content: '""',
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    borderTop: '1px solid var(--color-outline-variant)',
  },
  '.cm-hr-raw': { color: 'var(--color-on-surface-variant)' },
  '.cm-code, .cm-codeblock': {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.9em',
  },
  '.cm-code': {
    background: 'var(--color-surface-container-high)',
    borderRadius: '2px',
    padding: '0 2px',
  },
  '.cm-codeblock': { background: 'var(--color-surface-container-high)', padding: '0 0.75rem' },
  '.cm-quote': {
    borderLeft: '4px solid var(--color-outline-variant)',
    paddingLeft: '1rem !important',
    color: 'var(--color-on-surface-variant)',
    fontStyle: 'italic',
  },
  '.cm-table': {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.9em',
    background: 'var(--color-surface-container-low)',
    padding: '0 0.75rem !important',
  },
  '.cm-table-head': { fontWeight: 700 },
  '.cm-table-divider, .cm-table-pipe': { color: 'var(--color-on-surface-variant)' },
  '.cm-taskbox': {
    display: 'inline-grid',
    placeItems: 'center',
    width: '1.1em',
    height: '1.1em',
    margin: '0 0.15em',
    verticalAlign: '-0.15em',
    border: '2px solid var(--color-on-surface-variant)',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  '.cm-taskbox-on': {
    background: 'var(--color-primary)',
    borderColor: 'var(--color-primary)',
    color: 'var(--color-on-primary)',
  },
  '.cm-listmark': { color: 'var(--color-on-surface-variant)' },
  '.cm-link': { color: 'var(--color-primary)', textDecoration: 'underline' },
  // CodeMirror adds `cm-tooltip` to the tooltip's own element, so the box it draws is this one.
  '.cm-tooltip.cm-link-tip': {
    border: 'none',
    background: 'transparent',
    padding: '4px 0 0',
  },
  '.cm-link-tip button': {
    minHeight: '40px',
    padding: '0 16px',
    borderRadius: '9999px',
    border: 'none',
    background: 'var(--color-secondary-container)',
    color: 'var(--color-on-secondary-container)',
    font: 'inherit',
    fontSize: '14px',
    boxShadow: '0 1px 4px rgb(0 0 0 / 0.3)',
    cursor: 'pointer',
  },
})

/**
 * Styles markdown in place and renders photo lines as pictures and attachment lines as chips.
 * Left out entirely in source mode.
 */
export const livePreview = [
  selectedPhoto,
  field,
  taskField,
  openLinks,
  linkTipField,
  Prec.high(
    keymap.of([
      { key: 'Backspace', run: removeSelected },
      { key: 'Delete', run: removeSelected },
    ]),
  ),
  styles,
]
