import type { KeyboardEvent } from 'react'

/**
 * Arrow keys for a `role="radiogroup"` of `role="radio"` buttons, from the group's `onKeyDown`: any
 * arrow moves to the neighbour (wrapping) and selects it, as native radios do. Give the checked one
 * `tabIndex` 0 and the rest -1 so the group is a single tab stop.
 */
export function radioKeys(e: KeyboardEvent<HTMLElement>): void {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
  const by = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]
  if (by === undefined) return
  const radios = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')]
  const at = radios.indexOf(e.target as HTMLElement)
  if (at < 0) return
  e.preventDefault()
  const to = radios[(at + by + radios.length) % radios.length]
  to?.focus()
  to?.click()
}

/**
 * Arrow-key movement for lists and grids made of buttons (and, in a list, a search box): call it
 * from the container's `onKeyDown`. `selector` picks the items inside `e.currentTarget` in document
 * order; `columns` is 1 for a list (only Up/Down) or the grid width (all four arrows). Home/End jump
 * to the ends, except in a text field, where they move the caret. Stops at the ends, never wraps.
 */
export function moveFocus(e: KeyboardEvent<HTMLElement>, selector: string, columns = 1): void {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>(selector)].filter(
    (el) => !('disabled' in el && el.disabled),
  )
  const at = items.indexOf(e.target as HTMLElement)
  if (at < 0) return
  const typing = e.target instanceof HTMLInputElement
  let to: number | undefined
  if (e.key === 'ArrowDown') to = at + columns
  else if (e.key === 'ArrowUp') to = at - columns
  else if (e.key === 'ArrowRight' && columns > 1) to = at + 1
  else if (e.key === 'ArrowLeft' && columns > 1) to = at - 1
  else if (e.key === 'Home' && !typing) to = 0
  else if (e.key === 'End' && !typing) to = items.length - 1
  if (to === undefined) return
  e.preventDefault()
  items[Math.min(Math.max(to, 0), items.length - 1)]?.focus()
}
