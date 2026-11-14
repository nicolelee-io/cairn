import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '../../lib/cn.ts'
import { moveFocus } from '../../lib/moveFocus.ts'
import { Icon } from '../Icon.tsx'

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1)
const MINUTES = Array.from({ length: 60 }, (_, i) => i)

/**
 * A themed time picker: a field showing the time, opening hour, minute and AM/PM columns beneath
 * it (the browser's own picker can't be styled). Values are 24-hour 'HH:mm'.
 */
export function TimeField({
  value,
  onChange,
  disabled,
  trailing,
}: {
  value: string
  onChange: (time: string) => void
  disabled?: boolean
  /** Sits beside the field (the All day switch); the picker still opens at full width below. */
  trailing?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [h24, minute] = value.split(':').map(Number) as [number, number]
  const pm = h24 >= 12
  const h12 = h24 % 12 || 12
  const pick = (h: number, m: number, isPm: boolean) =>
    onChange(
      `${String(((h % 12) + (isPm ? 12 : 0)) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
    )

  const panel = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  // Opened with Enter or Space (a click with no pointer): focus moves into the columns.
  const byKey = useRef(false)
  useEffect(() => {
    // Bring the current hour and minute to the middle of their columns on open.
    if (open)
      panel.current
        ?.querySelectorAll('[aria-pressed=true]')
        .forEach((e) => e.scrollIntoView({ block: 'center' }))
    if (open && byKey.current) panel.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus()
  }, [open])

  // Each column is one tab stop (its chosen value) and Up/Down move within it; Left/Right hop to
  // the next column, and Esc closes just the panel, not the dialog around it.
  const onPanelKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      trigger.current?.focus()
      return
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    const cols = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-col]')]
    const from = cols.indexOf((e.target as HTMLElement).closest<HTMLElement>('[data-col]')!)
    const to = cols[from + (e.key === 'ArrowLeft' ? -1 : 1)]
    if (from < 0 || !to) return
    e.preventDefault()
    to.querySelector<HTMLElement>('[tabindex="0"]')?.focus()
  }
  const onColKey = (e: KeyboardEvent<HTMLElement>) => moveFocus(e, 'button')

  const col = 'flex h-48 flex-col gap-1 overflow-y-auto py-1 [scrollbar-width:none]'
  const item = (on: boolean) =>
    cn(
      'state-layer grid h-10 shrink-0 cursor-pointer place-items-center rounded-full text-base',
      on && 'bg-primary text-on-primary',
    )

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-4">
        <button
          ref={trigger}
          type="button"
          disabled={disabled}
          aria-expanded={open && !disabled}
          onClick={(e) => {
            byKey.current = e.detail === 0
            setOpen((o) => !o)
          }}
          className="state-layer flex h-14 min-w-0 flex-1 cursor-pointer items-center justify-between rounded-sm border border-input px-4 text-base disabled:pointer-events-none disabled:opacity-40"
        >
          {h12}:{String(minute).padStart(2, '0')} {pm ? 'PM' : 'AM'}
          <Icon name="schedule" className="size-5 text-on-surface-variant" />
        </button>
        {trailing}
      </div>
      {open && !disabled && (
        <div
          ref={panel}
          role="group"
          aria-label="Pick a time"
          onKeyDown={onPanelKey}
          className="grid grid-cols-[1fr_1fr_auto] gap-3 rounded-lg border border-outline-variant px-3 py-2"
        >
          <div className={col} aria-label="Hour" role="listbox" data-col="" onKeyDown={onColKey}>
            {HOURS.map((h) => (
              <button
                key={h}
                type="button"
                role="option"
                aria-selected={h === h12}
                aria-pressed={h === h12}
                tabIndex={h === h12 ? 0 : -1}
                className={item(h === h12)}
                onClick={() => pick(h, minute, pm)}
              >
                {h}
              </button>
            ))}
          </div>
          <div className={col} aria-label="Minute" role="listbox" data-col="" onKeyDown={onColKey}>
            {MINUTES.map((m) => (
              <button
                key={m}
                type="button"
                role="option"
                aria-selected={m === minute}
                aria-pressed={m === minute}
                tabIndex={m === minute ? 0 : -1}
                className={item(m === minute)}
                onClick={() => pick(h12, m, pm)}
              >
                {String(m).padStart(2, '0')}
              </button>
            ))}
          </div>
          <div className="flex flex-col justify-center gap-1" data-col="" onKeyDown={onColKey}>
            {(['AM', 'PM'] as const).map((label) => (
              <button
                key={label}
                type="button"
                aria-pressed={pm === (label === 'PM')}
                tabIndex={pm === (label === 'PM') ? 0 : -1}
                className={cn(item(pm === (label === 'PM')), 'w-14')}
                onClick={() => pick(h12, minute, label === 'PM')}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
