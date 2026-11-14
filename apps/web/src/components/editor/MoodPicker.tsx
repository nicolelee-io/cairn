import { useEffect, useLayoutEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { MoodKey } from '@cairn/shared'
import { MoodGrid, MOOD_ROWS } from '../MoodGrid.tsx'

/**
 * Two columns of seven, each row an emoji and its name (`MoodGrid`). One tap picks the mood and closes; tapping the chosen one again clears it
 * (unrated stays null). Rendered inside a `relative` wrapper around the header's mood button, centred under it.
 * From the keyboard: focus starts on the chosen mood (else the first), the arrow keys and Home/End
 * move around the grid (up/down within a column, left/right across), Tab also steps through, Enter or Space picks, and `onDone` hands focus back
 * to the text after a pick or Esc.
 */
export function MoodPicker({
  value,
  onChange,
  onClose,
  onDone,
}: {
  value: MoodKey | null
  onChange: (mood: MoodKey | null) => void
  onClose: () => void
  /** After a pick or Esc made with the keyboard. */
  onDone?: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const buttons = [...(ref.current?.querySelectorAll('button') ?? [])]
    const at = buttons.findIndex((b) => b === document.activeElement)
    const step: Record<string, number> = {
      ArrowLeft: -MOOD_ROWS,
      ArrowRight: MOOD_ROWS,
      ArrowUp: -1,
      ArrowDown: 1,
    }
    let to: number | undefined
    if (e.key in step) to = at + step[e.key]!
    else if (e.key === 'Home') to = 0
    else if (e.key === 'End') to = buttons.length - 1
    if (to === undefined) return
    e.preventDefault()
    // Column-major: up/down step one, left/right a whole column; off either end stays put.
    buttons[to]?.focus()
  }

  // Centred under the button, nudged back inside the window when that would run off a narrow screen.
  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    root.style.marginLeft = '0px' // measure unshifted (effects can run twice)
    const { left, right } = root.getBoundingClientRect()
    const edge = 8
    const shift =
      left < edge ? edge - left : right > innerWidth - edge ? innerWidth - edge - right : 0
    root.style.marginLeft = `${shift}px`
  }, [])

  // Esc or a press outside closes it; focus starts on the chosen mood, else the first.
  useEffect(() => {
    const root = ref.current
    const first = root?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
    ;(first ?? root?.querySelector('button'))?.focus()
    const down = (e: PointerEvent) => {
      // The header's mood button toggles it, so a press on it must not also reopen it.
      const target = e.target as Element
      if (!root?.contains(target) && !target.closest('[data-mood-button]')) onClose()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Esc from the keyboard (focus inside the picker) puts the caret back in the text.
      if (root?.contains(document.activeElement)) onDone?.()
      onClose()
    }
    document.addEventListener('pointerdown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('keydown', key)
    }
  }, [onClose, onDone])

  return (
    <div
      ref={ref}
      role="group"
      aria-label="Mood"
      // The picker uses the arrow keys itself, so the shortcut listener leaves its keys alone.
      data-owns-keys=""
      onKeyDown={onKeyDown}
      className="absolute top-full left-1/2 z-30 mt-1 w-max -translate-x-1/2 rounded-xl bg-surface-container-high p-2 shadow-lg"
    >
      <MoodGrid
        value={value}
        onPick={(m, e) => {
          onChange(m.key === value ? null : m.key)
          // Enter or Space on a button is a click with no pointer (detail 0).
          if (e.detail === 0) onDone?.()
        }}
      />
    </div>
  )
}
