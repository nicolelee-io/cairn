import { useEffect, useId, useRef, useState } from 'react'
import { cn } from '../../lib/cn.ts'
import { Icon } from '../Icon.tsx'
import { JournalDot } from '../JournalBadge.tsx'

export interface SelectOption {
  value: string
  label: string
  /** A colour dot before the label (journals); '' uses the theme colour. */
  dot?: string | null
  /** An emoji before the label, in the emoji font (moods). */
  emoji?: string
}

function OptionText({ option }: { option: SelectOption | undefined }) {
  return (
    <span className="min-w-0 flex-1 truncate">
      {option?.emoji && <span className="font-emoji">{option.emoji} </span>}
      {option?.label ?? 'Choose…'}
    </span>
  )
}

/**
 * A themed replacement for the native <select>, whose open list can't be styled: a pill that opens
 * a floating list. Keys: Up/Down move, Enter picks, Esc closes. Long lists that need search or
 * touch-sized rows get a dialog instead (see TimezoneDialog).
 */
export function Select({
  value,
  options,
  onChange,
  label,
  above = false,
  onDone,
  className,
}: {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  /** Accessible name. */
  label: string
  /** Open the list upward (for a select near the bottom of the screen). */
  above?: boolean
  /** After a pick or Esc made with the keyboard (the editor hands focus back to the text). */
  onDone?: () => void
  className?: string
}) {
  const id = useId()
  const listId = `${id}-list`
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const current = options.find((o) => o.value === value)

  const openList = () => {
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.value === value),
      ),
    )
    setOpen(true)
  }
  const pick = (o: SelectOption | undefined) => {
    if (!o) return
    onChange(o.value)
    setOpen(false)
    trigger.current?.focus()
  }

  // Click or tap outside closes it.
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  // Keep the highlighted row in view as the arrows move it.
  useEffect(() => {
    if (open) listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        openList()
      }
      return
    }
    if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, options.length - 1))
    else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0))
    else if (e.key === 'Home') setActive(0)
    else if (e.key === 'End') setActive(options.length - 1)
    else if (e.key === 'Enter') {
      pick(options[active])
      onDone?.()
    } else if (e.key === 'Escape') {
      // Keep Esc from also closing a dialog this select lives in.
      e.stopPropagation()
      setOpen(false)
      onDone?.()
    } else if (e.key === 'Tab') setOpen(false)
    else return
    e.preventDefault()
  }

  return (
    <div ref={root} className={cn('relative', className)}>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        className="state-layer flex h-10 max-w-full cursor-pointer items-center gap-2 rounded-full bg-surface-container-high pr-2 pl-3 text-left text-sm"
      >
        {current?.dot !== undefined && <JournalDot color={current.dot} />}
        <OptionText option={current} />
        <Icon
          name={open ? 'keyboard_arrow_up' : 'keyboard_arrow_down'}
          className="size-5 text-on-surface-variant"
        />
      </button>
      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          className={cn(
            'absolute left-0 z-40 max-h-64 min-w-full overflow-y-auto rounded-lg bg-surface-container-high py-1 shadow-md',
            above ? 'bottom-full mb-1' : 'top-full mt-1',
          )}
        >
          {options.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              onPointerMove={() => setActive(i)}
              onClick={() => pick(o)}
              className={cn(
                'flex min-h-11 cursor-pointer items-center gap-3 px-4 text-sm whitespace-nowrap',
                i === active && 'bg-on-surface/8',
                o.value === value && 'font-medium text-primary',
              )}
            >
              {o.dot !== undefined && <JournalDot color={o.dot} />}
              <OptionText option={o} />
              {o.value === value && <Icon name="check" className="size-4" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
