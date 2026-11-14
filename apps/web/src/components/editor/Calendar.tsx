import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { monthGrid } from '../../lib/calendar.ts'
import { cn } from '../../lib/cn.ts'
import { moveFocus } from '../../lib/moveFocus.ts'
import { Icon } from '../Icon.tsx'
import { Button } from '../ui/button.tsx'

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const MONTHS = Array.from({ length: 12 }, (_, i) =>
  new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(
    Date.UTC(2000, i, 1),
  ),
)
const pad = (n: number) => String(n).padStart(2, '0')

type Mode = 'days' | 'months' | 'years'

/**
 * A date picker. The heading steps through three views, so a far-off date takes a few taps, not
 * dozens of arrows: days, then tap the month to pick a month, then tap the year to pick a year.
 * Dates are 'YYYY-MM-DD' strings; there is no time zone in play here.
 */
export function Calendar({
  value,
  today,
  onChange,
}: {
  value: string
  /** Marked with a ring, in the entry's own zone. */
  today: string
  onChange: (date: string) => void
}) {
  const [view, setView] = useState({ y: +value.slice(0, 4), m: +value.slice(5, 7) })
  const [mode, setMode] = useState<Mode>('days')
  // A date set from outside (the dialog's "Now") brings the calendar to its month.
  const [seen, setSeen] = useState(value)
  if (seen !== value) {
    setSeen(value)
    setView({ y: +value.slice(0, 4), m: +value.slice(5, 7) })
    setMode('days')
  }
  const selectedYear = useRef<HTMLButtonElement>(null)
  // Years show twelve at a time; this is the first of the page on screen.
  const [yearStart, setYearStart] = useState(() => view.y - (view.y % 12))

  const body = useRef<HTMLDivElement>(null)
  // A day to focus once the month it is in has rendered (the arrows can cross into the next one).
  const focusDay = useRef<string | null>(null)
  const firstMode = useRef(true)

  useEffect(() => {
    if (mode === 'years') selectedYear.current?.scrollIntoView({ block: 'nearest' })
    // Stepping to another view (the old controls are gone) puts focus on the new one's tab stop.
    if (firstMode.current) firstMode.current = false
    else body.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus()
  }, [mode])

  useEffect(() => {
    if (!focusDay.current) return
    body.current?.querySelector<HTMLElement>(`[aria-label="${focusDay.current}"]`)?.focus()
    focusDay.current = null
  }, [view])

  const grid = monthGrid(view.y, view.m)
  const iso = (d: number) => `${view.y}-${pad(view.m)}-${pad(d)}`
  // Days: Left/Right a day, Up/Down a week, PageUp/PageDown a month (same day, or the month's last).
  const onDayKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
    const from = (e.target as HTMLElement).getAttribute('aria-label')
    if (!from || !/^\d{4}-\d\d-\d\d$/.test(from)) return
    const [y, m, d] = from.split('-').map(Number) as [number, number, number]
    let to: Date
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      const by = e.key === 'PageUp' ? -1 : 1
      const last = new Date(Date.UTC(y, m - 1 + by + 1, 0)).getUTCDate()
      to = new Date(Date.UTC(y, m - 1 + by, Math.min(d, last)))
    } else {
      const by = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]
      if (by === undefined) return
      to = new Date(Date.UTC(y, m - 1, d + by))
    }
    e.preventDefault()
    const next = to.toISOString().slice(0, 10)
    const [ny, nm] = [to.getUTCFullYear(), to.getUTCMonth() + 1]
    if (ny === view.y && nm === view.m) {
      body.current?.querySelector<HTMLElement>(`[aria-label="${next}"]`)?.focus()
    } else {
      focusDay.current = next
      setView({ y: ny, m: nm })
    }
  }
  // The one tab stop among the days: the chosen date when it is on screen, else the 1st.
  const tabDay = value.startsWith(`${view.y}-${pad(view.m)}-`) ? +value.slice(8, 10) : 1
  const stepMonth = (by: number) =>
    setView(({ y, m }) => {
      const n = y * 12 + (m - 1) + by
      return { y: Math.floor(n / 12), m: (n % 12) + 1 }
    })

  const heading =
    mode === 'days'
      ? grid.label
      : mode === 'months'
        ? String(view.y)
        : `${yearStart} – ${yearStart + 11}`
  const prev = () =>
    mode === 'days'
      ? stepMonth(-1)
      : mode === 'months'
        ? setView((v) => ({ ...v, y: v.y - 1 }))
        : setYearStart((y) => y - 12)
  const next = () =>
    mode === 'days'
      ? stepMonth(1)
      : mode === 'months'
        ? setView((v) => ({ ...v, y: v.y + 1 }))
        : setYearStart((y) => y + 12)

  const cell = 'state-layer grid h-10 cursor-pointer place-items-center rounded-full text-sm'

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <button
          type="button"
          aria-live="polite"
          aria-label={
            mode === 'years' ? heading : `${heading}, choose ${mode === 'days' ? 'month' : 'year'}`
          }
          disabled={mode === 'years'}
          onClick={() => setMode(mode === 'days' ? 'months' : 'years')}
          className="state-layer -ml-1 inline-flex h-10 cursor-pointer items-center gap-1 rounded-full pr-2 pl-3 text-base font-medium disabled:pointer-events-none"
        >
          {heading}
          {mode !== 'years' && <Icon name="keyboard_arrow_down" className="size-5" />}
        </button>
        <div className="flex">
          <Button variant="text" size="icon" aria-label="Previous" onClick={prev}>
            <Icon name="chevron_right" className="rotate-180" />
          </Button>
          <Button variant="text" size="icon" aria-label="Next" onClick={next}>
            <Icon name="chevron_right" />
          </Button>
        </div>
      </div>

      {/* One height for all three views, so the dialog doesn't jump as you browse; a 5-week month
          spreads its rows over it instead of leaving a gap below. */}
      <div ref={body} className="h-[18.5rem]">
        {mode === 'days' && (
          <div
            role="grid"
            aria-label={grid.label}
            onKeyDown={onDayKey}
            className="grid h-full grid-cols-7 content-between gap-y-1 text-center"
          >
            {WEEKDAYS.map((w, i) => (
              <span key={i} aria-hidden="true" className="py-1 text-xs text-on-surface-variant">
                {w}
              </span>
            ))}
            {grid.weeks.flat().map((d, i) =>
              d === null ? (
                <span key={i} />
              ) : (
                <button
                  key={i}
                  type="button"
                  aria-label={iso(d)}
                  aria-pressed={iso(d) === value}
                  tabIndex={d === tabDay ? 0 : -1}
                  data-autofocus={d === tabDay ? '' : undefined}
                  onClick={() => onChange(iso(d))}
                  className={cn(
                    cell,
                    'mx-auto w-10',
                    iso(d) === value
                      ? 'bg-primary text-on-primary'
                      : iso(d) === today && 'border border-primary text-primary',
                  )}
                >
                  {d}
                </button>
              ),
            )}
          </div>
        )}
        {mode === 'months' && (
          <div className="grid grid-cols-3 gap-2 pt-2" onKeyDown={(e) => moveFocus(e, 'button', 3)}>
            {MONTHS.map((name, i) => (
              <button
                key={name}
                type="button"
                tabIndex={i + 1 === view.m ? 0 : -1}
                aria-pressed={i + 1 === view.m && view.y === +value.slice(0, 4)}
                onClick={() => {
                  setView((v) => ({ ...v, m: i + 1 }))
                  setMode('days')
                }}
                className={cn(
                  cell,
                  'h-14',
                  i + 1 === view.m ? 'bg-secondary-container text-on-secondary-container' : '',
                )}
              >
                {name}
              </button>
            ))}
          </div>
        )}
        {mode === 'years' && (
          <div className="grid grid-cols-3 gap-2 pt-2" onKeyDown={(e) => moveFocus(e, 'button', 3)}>
            {Array.from({ length: 12 }, (_, i) => yearStart + i).map((y) => (
              <button
                key={y}
                ref={y === view.y ? selectedYear : undefined}
                type="button"
                // The selected year when this page has it, else the first.
                tabIndex={
                  (view.y >= yearStart && view.y < yearStart + 12 ? y === view.y : y === yearStart)
                    ? 0
                    : -1
                }
                aria-pressed={y === view.y}
                onClick={() => {
                  setView((v) => ({ ...v, y }))
                  setMode('months')
                }}
                className={cn(
                  cell,
                  'h-14',
                  y === view.y ? 'bg-secondary-container text-on-secondary-container' : '',
                )}
              >
                {y}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
