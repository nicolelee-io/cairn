import { useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react'
import { useNavigate } from 'react-router'
import { entryLabel, type InsightsMonth } from '@cairn/shared'
import { useMe } from '../auth/useAuth.ts'
import { savedScroll } from '../lib/browseView.ts'
import { moveDay } from '../lib/cardFocus.ts'
import { useShortcuts } from '../lib/shortcuts.ts'
import { monthGrid } from '../lib/calendar.ts'
import { journalWash } from '../lib/journalColors.ts'
import { cn } from '../lib/cn.ts'
import { dayKey, timeLabel } from '../lib/format.ts'
import { useMenuTrigger } from '../lib/contextMenu.ts'
import { useEntryMenu } from '../lib/menuActions.ts'
import {
  useInsightsDay,
  useInsightsFirstMonth,
  useInsightsMonth,
  useJournals,
} from '../lib/queries.ts'
import { useServerDown } from '../lib/serverStatus.ts'
import { useBrowseParams } from '../lib/useBrowseParams.ts'
import { DayEntries, dayTitle } from './DayEntries.tsx'
import { NeedsConnection } from './NeedsConnection.tsx'
import { Dialog } from './ui/dialog.tsx'

const pad = (n: number) => String(n).padStart(2, '0')
/** Months shown after the current one, so there is room to look ahead. */
const FUTURE_MONTHS = 2

/** 'YYYY-MM' keys from `from` to `to`, oldest first. */
function monthKeys(from: string, to: string): string[] {
  const index = (k: string) => {
    const [y, m] = k.split('-').map(Number) as [number, number]
    return y * 12 + m - 1
  }
  const out: string[] = []
  for (let i = index(from); i <= index(to); i++)
    out.push(`${Math.floor(i / 12)}-${pad((i % 12) + 1)}`)
  return out
}

/**
 * The fill of a day with entries from the given journals' colours: one wash, or equal bands side
 * by side when the day spans several journals. undefined when none has a colour (the theme's).
 */
function dayWash(colors: (string | null | undefined)[]): string | undefined {
  if (!colors.some(Boolean)) return undefined
  const washes = colors.map(
    (c) => journalWash(c, 'surface-container-low', 38) ?? 'var(--md-primary-container)',
  )
  if (washes.length === 1) return washes[0]
  const stops = washes.map(
    (w, i) => `${w} ${(i * 100) / washes.length}% ${((i + 1) * 100) / washes.length}%`,
  )
  return `linear-gradient(135deg, ${stops.join(', ')})`
}

/**
 * The Entries screen's calendar: a month grid per month, oldest first so scrolling down goes forward
 * in time, from the oldest entry to a couple of months ahead, with the days that have entries
 * filled in (Day One's Calendar). It opens with the current month at the top. A day with one entry opens it; a day with several lists
 * them in a dialog. Worked out by the server (the Insights endpoints, narrowed to the journal being
 * browsed), so it needs a connection.
 */
export function CalendarView() {
  const { journalId, entryId, base } = useBrowseParams()
  const journals = useJournals()
  const journalColors = useMemo(
    () => new Map(journals.data?.map((j) => [j.id, j.color])),
    [journals.data],
  )
  const tz = useMe().data?.defaultTimezone ?? 'UTC'
  const [now] = useState(() => Date.now())
  const today = dayKey(now, tz)
  const down = useServerDown()
  const first = useInsightsFirstMonth(journalId)
  // The day whose entries the dialog lists, with the entry open when it was picked: a card in the
  // dialog opens an entry beside the calendar, which changes `entryId` and so closes the dialog.
  const [pick, setPick] = useState<{ day: string; entryId?: string } | null>(null)
  const selected = pick && pick.entryId === entryId ? pick.day : null

  const firstMonth = first.data?.month
  const lastMonth = first.data?.lastMonth
  const months = useMemo(() => {
    const [y, m] = today.split('-').map(Number) as [number, number]
    const soon = new Date(Date.UTC(y, m - 1 + FUTURE_MONTHS, 1)).toISOString().slice(0, 7)
    // An entry dated further ahead than that still gets its month.
    const end = lastMonth && lastMonth > soon ? lastMonth : soon
    return firstMonth ? monthKeys(firstMonth, end) : []
  }, [today, firstMonth, lastMonth])

  // Open on the current month, once per journal (the sticky bars sit above it, see scroll-mt).
  const current = useRef<HTMLElement>(null)
  const scrolledFor = useRef<string | null>(null)
  // Whether a place was saved for this journal's calendar, read as soon as the journal is known:
  // BrowseLayout (a parent, so its effects run after this one's) puts that place back and saves
  // whatever the page does while it loads, which would make every visit look like a return.
  const hadPlace = useRef<{ journal: string; had: boolean } | null>(null)
  useLayoutEffect(() => {
    hadPlace.current = {
      journal: journalId ?? '',
      // Above 0: arriving from a scrolled view saves a 0, which is no place to come back to.
      had: (savedScroll('calendar', journalId) ?? 0) > 0,
    }
  }, [journalId])
  useLayoutEffect(() => {
    if (months.length === 0 || scrolledFor.current === (journalId ?? '')) return
    scrolledFor.current = journalId ?? ''
    // Coming back to the calendar, BrowseLayout puts it where it was left instead.
    const returning = hadPlace.current?.journal === (journalId ?? '') && hadPlace.current.had
    if (!returning) current.current?.scrollIntoView()
  }, [months, journalId])

  // Keyboard: ←/→ walk the days with entries (when no entry is open: the reader owns the arrows then).
  useShortcuts([
    { id: 'calendar.next', when: () => !entryId, run: () => moveDay(1) },
    { id: 'calendar.prev', when: () => !entryId, run: () => moveDay(-1) },
    { id: 'calendar.today', run: () => current.current?.scrollIntoView() },
  ])

  return (
    <div className="flex flex-col gap-2">
      {down ? (
        <NeedsConnection onRetry={() => void first.refetch()} />
      ) : (
        <>
          {first.isError && <p role="alert">Couldn’t load the calendar.</p>}
          {first.data?.month === null && <p className="text-on-surface-variant">No entries yet.</p>}
          {months.map((m) => (
            <MonthBlock
              key={m}
              ref={m === today.slice(0, 7) ? current : undefined}
              month={m}
              today={today}
              journalId={journalId}
              colors={journalColors}
              base={base}
              onPickMany={(day) => setPick({ day, entryId })}
            />
          ))}
        </>
      )}
      <Dialog
        open={selected !== null}
        onClose={() => setPick(null)}
        title={dayTitle(selected ?? today)}
        showClose
      >
        {selected && <DayEntries day={selected} journalId={journalId} base={base} />}
      </Dialog>
    </div>
  )
}

/**
 * One month's grid. The grid is there from the start, so the page has its full height and scrolling
 * doesn't jump; the days with entries are fetched once the month comes near the screen.
 */
function MonthBlock({
  ref,
  month,
  today,
  journalId,
  colors,
  base,
  onPickMany,
}: {
  ref?: Ref<HTMLElement>
  month: string
  today: string
  journalId?: string
  /** Journal colours by id: they tint the days with entries (a day in several journals is banded). */
  colors: Map<string, string | null>
  base: string
  onPickMany: (day: string) => void
}) {
  // An entry already open beside the calendar is replaced, not stacked (lib/navigation.ts).
  const { entryId: openId } = useBrowseParams()
  const [year, mon] = month.split('-').map(Number) as [number, number]
  const { label, weeks } = monthGrid(year, mon)
  const [near, setNear] = useState(false)
  const box = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    const el = box.current
    if (!el || near) return
    const io = new IntersectionObserver(
      (e) => {
        if (e[0]?.isIntersecting) setNear(true)
      },
      { rootMargin: '1000px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [near])
  const data = useInsightsMonth(month, journalId, near)
  const days = new Map(data.data?.days.map((d) => [d.day, d]))

  return (
    <section
      ref={(el) => {
        box.current = el
        if (typeof ref === 'function') ref(el)
        else if (ref) ref.current = el
      }}
      aria-label={label}
      className="flex scroll-mt-26 flex-col gap-2 pt-2 pb-4"
    >
      <h2 className="text-xl">{label}</h2>
      <div className="grid grid-cols-7 gap-1">
        {weeks.flat().map((day, i) => {
          if (day === null) return <span key={i} />
          const dayStr = `${month}-${pad(day)}`
          const d = days.get(dayStr)
          const cell = cn(
            'grid h-12 place-items-center rounded-lg text-base',
            dayStr === today && 'ring-2 ring-primary',
          )
          if (!d)
            return (
              <span
                key={i}
                className={cn(cell, 'bg-surface-container-low text-on-surface-variant')}
              >
                {day}
              </span>
            )
          return (
            <DayCell
              key={i}
              day={day}
              dayStr={dayStr}
              d={d}
              cell={cell}
              colors={colors}
              journalId={journalId}
              base={base}
              replace={!!openId}
              onPickMany={onPickMany}
            />
          )
        })}
      </div>
    </section>
  )
}

/**
 * A calendar day that has entries. A tap opens the entry (or lists the day's entries); right-click,
 * long press and the Menu key open the entry's own menu on a one-entry day, or list the entries on
 * a busier one. The day's entries are fetched when the pointer or focus reaches the day (a long
 * press takes 500ms, so they are usually there by then), not for every day of every month.
 */
function DayCell({
  day,
  dayStr,
  d,
  cell,
  colors,
  journalId,
  base,
  replace,
  onPickMany,
}: {
  day: number
  dayStr: string
  d: InsightsMonth['days'][number]
  cell: string
  colors: Map<string, string | null>
  journalId?: string
  base: string
  replace: boolean
  onPickMany: (day: string) => void
}) {
  const navigate = useNavigate()
  const [wanted, setWanted] = useState(false)
  const items = useInsightsDay(wanted ? dayStr : null, journalId).data?.items
  const only = d.entryId ? items?.find((i) => i.id === d.entryId) : undefined
  const entryPath = (id: string) => `${base}/entry/${id}`
  const open = (id: string) => void navigate(entryPath(id), { replace })
  // useEntryMenu is a hook, so it always gets an entry; `build` only uses it for a loaded one-entry day.
  const entryMenu = useEntryMenu(
    {
      id: only?.id ?? '',
      journalId: only?.journalId ?? '',
      pinned: !!only?.pinned,
      starred: !!only?.starred,
      label: only ? entryLabel(only) : '',
    },
    { editTo: `${entryPath(only?.id ?? '')}/edit` },
  )
  const trigger = useMenuTrigger(() => {
    if (only) return entryMenu()
    if (!items || items.length === 0)
      return d.entryId
        ? [{ id: 'open', label: 'Open entry', icon: 'article', run: () => open(d.entryId!) }]
        : [{ id: 'open', label: 'Show entries', icon: 'article', run: () => onPickMany(dayStr) }]
    return items.map((item) => ({
      id: item.id,
      label: `${timeLabel(item.createdAt, item.timezone)} · ${entryLabel(item)}`,
      icon: 'article' as const,
      run: () => open(item.id),
    }))
  }, dayTitle(dayStr))
  const bg = dayWash(d.journalIds.map((id) => colors.get(id)))
  return (
    <button
      type="button"
      data-day=""
      aria-label={`${dayTitle(dayStr)}: ${d.entries} ${d.entries === 1 ? 'entry' : 'entries'}`}
      {...trigger}
      onPointerEnter={() => setWanted(true)}
      onFocus={() => setWanted(true)}
      onPointerDown={(e) => {
        setWanted(true)
        trigger.onPointerDown(e)
      }}
      onClick={() => (d.entryId ? open(d.entryId) : onPickMany(dayStr))}
      className={cn(
        cell,
        'state-layer scroll-mt-32 cursor-pointer [-webkit-touch-callout:none]',
        bg ? 'text-on-surface' : 'bg-primary-container text-on-primary-container',
      )}
      style={{ background: bg }}
    >
      {day}
    </button>
  )
}
