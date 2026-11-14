import { Fragment, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { openMenuFrom, type MenuAction } from '../../lib/contextMenu.ts'
import { isCoarse } from '../../lib/pointer.ts'
import { cn } from '../../lib/cn.ts'
import { shortcutHint, type CatalogId } from '../../lib/shortcutCatalog.ts'
import { useTip } from '../../lib/useTip.tsx'
import { Icon, type IconName } from '../Icon.tsx'
import type { EditorHandle } from './cm/MarkdownEditor.tsx'
import { foldedGroups, type ToolGroup } from './toolbarLayout.ts'
import { attachMenu, blocksMenu, headingMenu, stylingMenu } from './toolbarMenus.ts'

export const toolbarButton =
  // 48px on a touch screen, 44px under 380px wide: the five group buttons and undo/redo are seven.
  'state-layer grid size-9 pointer-coarse:size-12 pointer-coarse:max-[380px]:size-11 shrink-0 cursor-pointer place-items-center rounded-full text-on-surface-variant'

/**
 * One toolbar button. Pointer-down is cancelled so it never takes focus: the keyboard stays open
 * and the selection stays where it was. `shortcut` is a catalog id whose keys end the hover tip.
 */
function ToolButton({
  icon,
  label,
  shortcut,
  menu,
  expanded,
  iconClass,
  onClick,
}: {
  icon: IconName
  /** For a glyph that sits small in its box. */
  iconClass?: string
  label: string
  shortcut?: CatalogId
  /** Opens a menu: the button is marked as a popup. */
  menu?: boolean
  /** The inline panel this button opens is showing. */
  expanded?: boolean
  /** `byKeyboard`: Enter or Space (a click with no pointer), so a menu may put focus in itself. */
  onClick: (button: HTMLButtonElement, byKeyboard: boolean) => void
}) {
  const tip = useTip(shortcut ? `${label} (${shortcutHint(shortcut)})` : label)
  return (
    <button
      type="button"
      aria-label={label}
      aria-haspopup={menu ? 'menu' : undefined}
      aria-expanded={menu && expanded !== undefined ? expanded : undefined}
      className={cn(
        toolbarButton,
        expanded && 'bg-secondary-container text-on-secondary-container',
      )}
      {...tip.bind}
      onPointerDown={(e) => {
        tip.bind.onPointerDown()
        e.preventDefault() // never take focus from the text
      }}
      onClick={(e) => onClick(e.currentTarget, e.detail === 0)}
    >
      {tip.node}
      <Icon name={icon} className={iconClass} />
    </button>
  )
}

/**
 * A touch screen's version of a menu: a row of choices that sits right above the toolbar. It is not
 * a dialog, so the keyboard stays up and the caret stays put (pointer-down is cancelled like the
 * toolbar's own buttons).
 */
function ToolPanel({
  label,
  actions,
  onDone,
}: {
  label: string
  actions: MenuAction[]
  onDone: () => void
}) {
  return (
    <div
      role="menu"
      aria-label={label}
      className="absolute inset-x-0 bottom-full mb-1 flex gap-1 overflow-x-auto rounded-2xl bg-surface-container-high p-1 shadow-md [scrollbar-width:none]"
    >
      {actions.map((a) => (
        <button
          key={a.id}
          type="button"
          role="menuitem"
          aria-checked={a.checked}
          disabled={!!a.disabled}
          className={cn(
            'state-layer flex min-w-16 shrink-0 cursor-pointer flex-col items-center gap-0.5 rounded-xl px-3 py-2 text-xs text-on-surface',
            a.checked && 'bg-secondary-container text-on-secondary-container',
          )}
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => {
            onDone()
            a.run()
          }}
        >
          <Icon name={a.icon} />
          {a.label}
          {a.checked && <span className="sr-only">Selected</span>}
        </button>
      ))}
    </div>
  )
}

type Group = ToolGroup

/** The key behind each menu action, for the tip on its button in the mouse toolbar. */
const SHORTCUTS: Record<string, CatalogId | undefined> = {
  h1: 'editor.h1',
  h2: 'editor.h2',
  h3: 'editor.h3',
  bold: 'editor.bold',
  italic: 'editor.italic',
  strike: 'editor.strike',
  link: 'editor.link',
  bullets: 'editor.bullets',
  numbers: 'editor.numbers',
  quote: 'editor.quote',
  photos: 'editor.photos',
  files: 'editor.files',
}

/**
 * The editor's buttons, from the same four groups (Heading, Text styling, Lists and blocks,
 * Attachments, defined in toolbarMenus.ts). On a touch screen each group is one big button opening
 * a panel of its choices, so six buttons never need to scroll; with a mouse every choice is its own
 * button, set apart by a rule, and groups fold back into one menu button each as the row runs short
 * (toolbarLayout.ts). Undo/redo are pinned at the right in both.
 */
export function Toolbar({
  target,
  onAddPhotos,
  onAddFiles,
  onCamera,
  templates,
}: {
  target: RefObject<EditorHandle | null>
  /** The phone's photo picker (`image/*` only), so it stays apart from Files. */
  onAddPhotos: () => void
  /** PDFs, video and audio. */
  onAddFiles: () => void
  /** Take a photo with the camera; offered on a touch screen only. */
  onCamera: () => void
  /**
   * The Templates menu (`useTemplatesMenu`). A touch screen has a button for it after the groups,
   * where there is room; with a mouse it is in the editor's header, so this is not used there.
   */
  templates: () => MenuAction[]
}) {
  const root = useRef<HTMLDivElement>(null)
  const [panel, setPanel] = useState<Group | null>(null)
  // Touch: choices open in a panel above the toolbar (no dialog, so the keyboard isn't disturbed).
  const inline = isCoarse()

  useEffect(() => {
    if (!panel) return
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setPanel(null)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setPanel(null)
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [panel])

  const groups: {
    id: Group
    icon: IconName
    iconClass?: string
    label: string
    menu: () => MenuAction[]
  }[] = [
    { id: 'heading', icon: 'title', label: 'Heading', menu: () => headingMenu(target) },
    {
      id: 'styling',
      icon: 'match_case',
      iconClass: 'scale-125',
      label: 'Text styling',
      menu: () => stylingMenu(target),
    },
    {
      id: 'blocks',
      icon: 'format_list_bulleted',
      label: 'Lists and blocks',
      menu: () => blocksMenu(target),
    },
    {
      id: 'attach',
      icon: 'attach_file',
      label: 'Attachments',
      menu: () => attachMenu(onAddPhotos, onAddFiles, inline ? onCamera : undefined),
    },
  ]
  // Open, a group is a button per choice. The headings are levels only: pressing the one the line
  // has takes it off again, so Paragraph needs no button.
  const choices = (g: (typeof groups)[number]) =>
    g.id === 'heading' ? g.menu().filter((a) => a.id !== 'paragraph') : g.menu()

  // Mouse: how many groups fit beside undo/redo, measured on the row they share.
  const row = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState(Infinity)
  useLayoutEffect(() => {
    const el = row.current
    if (inline || !el) return
    const measure = () => setRoom(el.clientWidth)
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    return () => watch.disconnect()
  }, [inline])
  const open = groups.find((g) => g.id === panel)

  const undoRedo = (
    <div className="flex shrink-0 items-center gap-1">
      <ToolButton icon="undo" label="Undo" onClick={() => target.current?.undo()} />
      <ToolButton icon="redo" label="Redo" onClick={() => target.current?.redo()} />
    </div>
  )

  // Mouse: every choice is its own button, the groups set apart by a rule. A group folds into one
  // menu button when the row would run into undo/redo (toolbarLayout.ts).
  if (!inline) {
    const folded = foldedGroups(
      room,
      groups.map((g) => ({ id: g.id, count: choices(g).length })),
    )
    return (
      <div
        ref={root}
        role="toolbar"
        aria-label="Formatting"
        className="relative flex items-center justify-between gap-1"
      >
        <div
          ref={row}
          className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]"
        >
          {groups.map((g, i) => (
            <Fragment key={g.id}>
              {i > 0 && <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-outline-variant" />}
              {folded.has(g.id) ? (
                <ToolButton
                  icon={g.icon}
                  iconClass={g.iconClass}
                  label={g.label}
                  menu
                  onClick={(b, key) =>
                    openMenuFrom(b, g.menu, g.label, undefined, { align: 'start', focusFirst: key })
                  }
                />
              ) : (
                choices(g).map((a) => (
                  <ToolButton
                    key={a.id}
                    icon={a.icon}
                    label={a.label}
                    shortcut={SHORTCUTS[a.id]}
                    onClick={() => a.run()}
                  />
                ))
              )}
            </Fragment>
          ))}
        </div>
        {undoRedo}
      </div>
    )
  }

  return (
    <div
      ref={root}
      role="toolbar"
      aria-label="Formatting"
      className="relative flex items-center justify-between gap-1"
    >
      {open && <ToolPanel label={open.label} actions={open.menu()} onDone={() => setPanel(null)} />}
      <div className="flex items-center gap-1">
        {groups.map((g) => (
          <ToolButton
            key={g.id}
            icon={g.icon}
            iconClass={g.iconClass}
            label={g.label}
            menu
            expanded={panel === g.id}
            onClick={() => setPanel((p) => (p === g.id ? null : g.id))}
          />
        ))}
        {/* Not a panel: the list can be long, so it is the shared menu (a sheet on touch). It takes
            focus from the text while open and the insert hands it back. */}
        <ToolButton
          icon="description"
          label="Templates"
          menu
          onClick={(b, key) => {
            setPanel(null)
            openMenuFrom(b, templates, 'Templates', undefined, { align: 'start', focusFirst: key })
          }}
        />
      </div>
      {undoRedo}
    </div>
  )
}
