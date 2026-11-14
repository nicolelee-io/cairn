import { useEffect, useMemo, useRef, useState } from 'react'
import { timezoneOptions } from '../../lib/entryTime.ts'
import { cn } from '../../lib/cn.ts'
import { moveFocus } from '../../lib/moveFocus.ts'
import { Icon } from '../Icon.tsx'
import { Dialog } from '../ui/dialog.tsx'

/** 'MDT' / 'GMT+9': the clock name in force at `at`, which says more than the region name does. */
function abbreviation(zone: string, at: number): string {
  try {
    return (
      new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' })
        .formatToParts(at)
        .find((p) => p.type === 'timeZoneName')?.value ?? ''
    )
  } catch {
    return ''
  }
}

/** A searchable list of zones in its own dialog (stacked over the date dialog): roomy on a phone. */
export function TimezoneDialog({
  open,
  value,
  at,
  onClose,
  onPick,
  title = 'Timezone',
  hint,
  suggest,
}: {
  open: boolean
  value: string
  /** The entry's instant, so the abbreviations match its date (daylight time or not). */
  at: number
  onClose: () => void
  onPick: (zone: string) => void
  title?: string
  /** A line above the search saying what the zone is for. */
  hint?: string
  /** A zone offered as a one-tap shortcut above the list (Settings: this device's zone). */
  suggest?: string
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      {open && (
        <List
          value={value}
          at={at}
          onClose={onClose}
          onPick={onPick}
          hint={hint}
          suggest={suggest}
        />
      )}
    </Dialog>
  )
}

function List({
  value,
  at,
  onClose,
  onPick,
  hint,
  suggest,
}: {
  value: string
  at: number
  onClose: () => void
  onPick: (zone: string) => void
  hint?: string
  suggest?: string
}) {
  const [query, setQuery] = useState('')
  const zones = useMemo(
    () =>
      timezoneOptions(value).map((z) => ({
        id: z,
        label: z.replaceAll('_', ' '),
        abbr: abbreviation(z, at),
      })),
    [value, at],
  )
  const q = query.trim().toLowerCase()
  // Cities that start with what was typed come first ("lon" finds London before Blanc-Sablon).
  const city = (z: { label: string }) => z.label.slice(z.label.lastIndexOf('/') + 1).toLowerCase()
  const shown = q
    ? zones
        .filter((z) => z.label.toLowerCase().includes(q) || z.abbr.toLowerCase().includes(q))
        .sort((a, b) => Number(city(b).startsWith(q)) - Number(city(a).startsWith(q)))
    : zones
  // Don't pop the keyboard up over the list on a touch screen; a mouse can type straight away.
  const search = useRef<HTMLInputElement>(null)
  useEffect(() => {
    // After the dialog has taken focus for itself.
    if (!window.matchMedia('(pointer: fine)').matches) return
    const t = setTimeout(() => search.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [])

  return (
    // Up/Down walk the data-row controls: the device-zone shortcut, the search box, the zones.
    <div className="flex flex-col gap-3" onKeyDown={(e) => moveFocus(e, '[data-row]')}>
      {hint && <p className="text-sm text-on-surface-variant">{hint}</p>}
      {suggest && suggest !== value && (
        <button
          type="button"
          data-row=""
          onClick={() => onPick(suggest)}
          className="state-layer -mx-2 flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-3 text-left text-primary"
        >
          <Icon name="my_location" className="size-5" />
          <span className="min-w-0 flex-1 truncate">
            Use this device’s timezone ({suggest.replaceAll('_', ' ')})
          </span>
        </button>
      )}
      <input
        type="search"
        ref={search}
        data-row=""
        aria-label="Search timezones"
        placeholder="Search by city or zone"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && shown[0]) {
            e.preventDefault()
            onPick(shown[0].id)
          }
        }}
        className="h-12 w-full rounded-sm border border-input bg-transparent px-4 text-base outline-none placeholder:text-on-surface-variant focus-visible:border-primary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
      />
      <ul className="-mx-2 -my-1 max-h-[50dvh] overflow-y-auto py-1">
        {shown.map((z) => (
          <li key={z.id}>
            <button
              type="button"
              data-row=""
              onClick={() => onPick(z.id)}
              className={cn(
                'state-layer flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-left',
                z.id === value && 'text-primary',
              )}
            >
              <span className="min-w-0 flex-1 truncate">{z.label}</span>
              <span className="shrink-0 text-sm text-on-surface-variant">{z.abbr}</span>
              {z.id === value && <Icon name="check" className="size-5" />}
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="px-3 py-3 text-on-surface-variant">No matches</li>}
      </ul>
      <button
        type="button"
        onClick={onClose}
        className="state-layer cursor-pointer self-end rounded-full px-4 py-2 text-sm font-medium text-primary"
      >
        Cancel
      </button>
    </div>
  )
}
