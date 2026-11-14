import {
  useRef,
  useSyncExternalStore,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react'
import type { IconName } from '../components/Icon.tsx'
import { isCoarse } from './pointer.ts'

/** One row of a context menu. Leave an action out of the list when it never applies. */
export interface MenuAction {
  id: string
  label: string
  icon: IconName
  /** A journal colour: the row shows a dot (and, in the FAB's pills, the colour accent) instead of the icon. '' is a journal with no colour. */
  dot?: string
  /** Shows a trailing check: the choice a plain tap would make. */
  checked?: boolean
  run: () => void
  destructive?: boolean
  /** Why it can't be used right now (offline, archived); the row stays visible and says so. */
  disabled?: string
}

/** How the menu was asked for: a touch gets a bottom sheet, anything else a popover; `anchor` is a stack of pills above an element (the FAB), whatever the input. */
export type MenuSource = 'mouse' | 'touch' | 'key' | 'anchor'

interface OpenMenu {
  title: string
  actions: MenuAction[]
  x: number
  y: number
  source: MenuSource
  /** `end`: `x` is the menu's right edge (opened from a button), else its left (the pointer). */
  align?: 'start' | 'end'
  /** Focus the first row when it opens (the default). Off for a mouse press: a focus ring on a row nobody chose looks like a highlight. */
  focusFirst?: boolean
  /** For `source: 'anchor'`: the element the pills rise from. */
  anchor?: { top: number; right: number }
}

// One menu at a time, rendered once by components/ContextMenu.tsx (in AppShell). It is a store
// because the rows that ask for it (entry cards, nav rows) come and go with their lists.
let current: OpenMenu | null = null
const listeners = new Set<() => void>()
const set = (m: OpenMenu | null) => {
  current = m
  listeners.forEach((l) => l())
}

export const openContextMenu = (m: OpenMenu) => set(m)
export const closeContextMenu = () => set(null)
export const useContextMenu = (): OpenMenu | null =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    () => current,
  )

/**
 * A menu opened by a touch press opens while the finger is still down, and the lift that follows
 * can reach the new modal dialog's backdrop as a `contextmenu` (Windows touch screens send one on
 * release) or a click, which would dismiss the menu the moment it appeared. While the finger is
 * down, and for a moment after it lifts, a backdrop dismissal is ignored (`releaseGuarded`).
 */
const RELEASE_GRACE_MS = 600
let fingerDown = false
let guardUntil = 0
function guardRelease() {
  fingerDown = true
  const lifted = () => {
    fingerDown = false
    guardUntil = Date.now() + RELEASE_GRACE_MS
    window.removeEventListener('pointerup', lifted, true)
    window.removeEventListener('pointercancel', lifted, true)
  }
  window.addEventListener('pointerup', lifted, true)
  window.addEventListener('pointercancel', lifted, true)
}
export const releaseGuarded = () => fingerDown || Date.now() < guardUntil

const LONG_PRESS_MS = 500
/** A finger that travels farther than this is scrolling, not pressing. */
const SLOP_PX = 10

/**
 * Props for an element that has a context menu: right-click, a long press (touch), and the Menu key
 * or Shift+F10 on a focused element. `build` runs when the menu is asked for, so it sees the latest
 * state. The press that opens the menu must not also click the link underneath, hence the
 * capture-phase click guard. With `anchored`, every input opens pills above the element itself
 * rather than a sheet or a popover at the pointer.
 */
export function useMenuTrigger(build: () => MenuAction[], title: string, anchored = false) {
  const timer = useRef<number | undefined>(undefined)
  const origin = useRef({ x: 0, y: 0 })
  const pointer = useRef('mouse')
  const swallowClick = useRef(false)

  const cancel = () => window.clearTimeout(timer.current)
  const open = (x: number, y: number, source: MenuSource, el: HTMLElement) => {
    const actions = build()
    if (!actions.length) return
    if (!anchored) return openContextMenu({ title, actions, x, y, source })
    const r = el.getBoundingClientRect()
    openContextMenu({
      title,
      actions,
      x: r.right,
      y: r.top,
      source: 'anchor',
      anchor: { top: r.top, right: r.right },
    })
  }

  return {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      pointer.current = e.pointerType
      swallowClick.current = false
      if (e.pointerType !== 'touch') return
      origin.current = { x: e.clientX, y: e.clientY }
      const { clientX, clientY } = e
      const el = e.currentTarget
      timer.current = window.setTimeout(() => {
        swallowClick.current = true
        navigator.vibrate?.(10)
        guardRelease()
        open(clientX, clientY, 'touch', el)
      }, LONG_PRESS_MS)
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      if (Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) > SLOP_PX) cancel()
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    // Android Chrome sends this itself after a long press; the timer above covers the browsers
    // that don't (iOS), so opening twice must be harmless.
    onContextMenu: (e: MouseEvent<HTMLElement>) => {
      e.preventDefault()
      cancel()
      const touch = pointer.current === 'touch'
      if (touch) swallowClick.current = true
      open(e.clientX, e.clientY, touch ? 'touch' : 'mouse', e.currentTarget)
    },
    onClickCapture: (e: MouseEvent<HTMLElement>) => {
      if (!swallowClick.current) return
      swallowClick.current = false
      e.preventDefault()
      e.stopPropagation()
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.key !== 'ContextMenu' && !(e.key === 'F10' && e.shiftKey)) return
      e.preventDefault()
      const r = e.currentTarget.getBoundingClientRect()
      open(r.left + 16, r.top + 16, 'key', e.currentTarget)
    },
  }
}

/**
 * Opens the menu from a visible button: below the button with a mouse, as a sheet on a touch screen.
 * `align: 'start'` hangs it from the button's left edge (a button at the left of a row), the
 * default from its right edge; `focusFirst: false` leaves focus on the menu itself.
 */
export function openMenuFrom(
  button: HTMLElement,
  build: () => MenuAction[],
  title: string,
  touch = isCoarse(),
  opts: { align?: 'start' | 'end'; focusFirst?: boolean } = {},
) {
  const actions = build()
  if (!actions.length) return
  const r = button.getBoundingClientRect()
  openContextMenu({
    title,
    actions,
    x: opts.align === 'start' ? r.left : r.right,
    y: r.bottom + 4,
    source: touch ? 'touch' : 'key',
    align: opts.align ?? 'end',
    focusFirst: opts.focusFirst,
  })
}
