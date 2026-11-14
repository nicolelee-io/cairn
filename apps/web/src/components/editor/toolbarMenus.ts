import type { RefObject } from 'react'
import type { MenuAction } from '../../lib/contextMenu.ts'
import {
  bold,
  checklist,
  clearHeading,
  divider,
  headingLevelAt,
  italic,
  link,
  prefixLines,
  strikethrough,
} from '../../lib/markdownEdit.ts'
import type { EditorHandle } from './cm/MarkdownEditor.tsx'

/** The heading levels, with a check on the one the caret's line has (none: it is a paragraph). */
export function headingMenu(target: RefObject<EditorHandle | null>): MenuAction[] {
  const ed = target.current
  const state = ed?.read()
  const level = state ? headingLevelAt(state.value, state.from) : 0
  const heading = (n: 1 | 2 | 3, icon: MenuAction['icon']): MenuAction => ({
    id: `h${n}`,
    label: `Heading ${n}`,
    icon,
    checked: level === n,
    // prefixLines takes the marker off when every line already has it, so a level is a toggle.
    run: () => ed?.edit((v, s, e) => prefixLines(v, s, e, `${'#'.repeat(n)} `)),
  })
  return [
    heading(1, 'format_h1'),
    heading(2, 'format_h2'),
    heading(3, 'format_h3'),
    {
      id: 'paragraph',
      label: 'Paragraph',
      icon: 'format_paragraph',
      checked: level === 0,
      run: () => ed?.edit(clearHeading),
    },
  ]
}

/** Bold, italic, strikethrough and link: the marks that wrap the selected text. */
export function stylingMenu(target: RefObject<EditorHandle | null>): MenuAction[] {
  const ed = target.current
  return [
    { id: 'bold', label: 'Bold', icon: 'format_bold', run: () => ed?.edit(bold) },
    { id: 'italic', label: 'Italic', icon: 'format_italic', run: () => ed?.edit(italic) },
    {
      id: 'strike',
      label: 'Strikethrough',
      icon: 'format_strikethrough',
      run: () => ed?.edit(strikethrough),
    },
    { id: 'link', label: 'Link', icon: 'link', run: () => ed?.edit(link) },
  ]
}

/** Lists, quote and divider: what acts on whole lines. */
export function blocksMenu(target: RefObject<EditorHandle | null>): MenuAction[] {
  const ed = target.current
  return [
    {
      id: 'bullets',
      label: 'Bulleted list',
      icon: 'format_list_bulleted',
      run: () => ed?.edit((v, s, e) => prefixLines(v, s, e, '- ')),
    },
    {
      id: 'numbers',
      label: 'Numbered list',
      icon: 'format_list_numbered',
      run: () => ed?.edit((v, s, e) => prefixLines(v, s, e, '1. ')),
    },
    { id: 'checklist', label: 'Checklist', icon: 'checklist', run: () => ed?.edit(checklist) },
    {
      id: 'quote',
      label: 'Quote',
      icon: 'format_quote',
      run: () => ed?.edit((v, s, e) => prefixLines(v, s, e, '> ')),
    },
    { id: 'divider', label: 'Divider', icon: 'horizontal_rule', run: () => ed?.edit(divider) },
  ]
}

/** Photos, camera and files. New inserts (templates, date) would get a group of their own. */
export function attachMenu(
  onAddPhotos: () => void,
  onAddFiles: () => void,
  /** Only given where a camera makes sense (a touch screen). */
  onCamera?: () => void,
): MenuAction[] {
  return [
    { id: 'photos', label: 'Photos', icon: 'add_photo_alternate', run: onAddPhotos },
    ...(onCamera
      ? [{ id: 'camera', label: 'Camera', icon: 'photo_camera' as const, run: onCamera }]
      : []),
    { id: 'files', label: 'Files', icon: 'attach_file', run: onAddFiles },
  ]
}
