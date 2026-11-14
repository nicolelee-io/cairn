import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import {
  TIME_OF_DAY,
  moodByKey,
  type InsightsMonth,
  type InsightsRange,
  type OnThisDay,
} from '@cairn/shared'
import { useMe } from '../auth/useAuth.ts'
import { DayEntries, dayTitle } from '../components/DayEntries.tsx'
import { EntryCard } from '../components/EntryCard.tsx'
import { EntryPopup } from '../components/EntryPopup.tsx'
import { EmptyState } from '../components/EmptyState.tsx'
import { Icon } from '../components/Icon.tsx'
import { MoodGrid } from '../components/MoodGrid.tsx'
import { SectionHeader } from '../components/SectionHeader.tsx'
import { Dialog } from '../components/ui/dialog.tsx'
import { NeedsConnection } from '../components/NeedsConnection.tsx'
import { moveDay } from '../lib/cardFocus.ts'
import { useEntryPopup, usePopupWidth } from '../lib/entryPopup.ts'
import { useShortcuts } from '../lib/shortcuts.ts'
import { useTip } from '../lib/useTip.tsx'
import { monthGrid } from '../lib/calendar.ts'
import { cn } from '../lib/cn.ts'
import { dayKey } from '../lib/format.ts'
import { radioKeys } from '../lib/moveFocus.ts'
import { useSlideSwipe } from '../lib/useSlideSwipe.ts'
import {
  journalById,
  useInsightsMonth,
  useInsightsStats,
  useJournals,
  useOnThisDay,
} from '../lib/queries.ts'
import { useServerDown } from '../lib/serverStatus.ts'
import { Page } from './Page.tsx'

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const RANGES: { value: InsightsRange; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'all', label: 'All time' },
]

const pad = (n: number) => String(n).padStart(2, '0')

// Grid columns by number of stats (full class names so Tailwind finds them): three across on a
// phone, two when that would leave a lone stat on the last row, one row from 840px.
const GRID: Record<number, string> = {
  4: 'grid-cols-2 expanded:grid-cols-4',
  5: 'grid-cols-3 expanded:grid-cols-5',
  6: 'grid-cols-3 expanded:grid-cols-6',
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-1 flex-col items-center gap-1 text-center">
      <span className="text-2xl">{value}</span>
      <span className="text-xs text-on-surface-variant">{label}</span>
    </div>
  )
}

/** Stats, a mood calendar and "On this day". All of it comes from the server, so it needs a connection. */
export function InsightsPage() {
  const me = useMe().data
  const tz = me?.defaultTimezone ?? 'UTC'
  const showStreak = me?.showStreak ?? true
  const showBest = showStreak && (me?.showBestStreak ?? true)
  const [now] = useState(() => Date.now())
  const today = dayKey(now, tz)
  const down = useServerDown()
  const [range, setRange] = useState<InsightsRange>('week')
  const stats = useInsightsStats(today, range)
  // The streak stats are the user's to hide (Settings > Appearance); the rest reflow.
  const d = stats.data
  const tiles = [
    { value: d ? String(d.total) : '–', label: 'Total entries' },
    { value: d ? d.days.toLocaleString() : '–', label: 'Days written' },
    { value: d ? d.words.toLocaleString() : '–', label: 'Words' },
    ...(showStreak ? [{ value: d ? String(d.currentStreak) : '–', label: 'Writing streak' }] : []),
    ...(showBest ? [{ value: d ? String(d.longestStreak) : '–', label: 'Best streak' }] : []),
    {
      value: d ? (TIME_OF_DAY.find((t) => t.key === d.mostActive)?.label ?? '–') : '–',
      label: 'Most active time',
    },
  ]
  const thisDay = useOnThisDay(today)
  // A swipe on the stats card moves along Week, Month, All time (left = the next one).
  const rangeAfter = (direction: 'left' | 'right') =>
    RANGES[RANGES.findIndex((r) => r.value === range) + (direction === 'left' ? 1 : -1)]
  const { ref: rangeRef, swipe: rangeSwipe } = useSlideSwipe<HTMLDivElement>(
    (direction) => {
      const next = rangeAfter(direction)
      if (next) setRange(next.value)
    },
    (direction) => !!rangeAfter(direction),
  )

  return (
    <Page title="Insights" icon="bar_chart" wide>
      {down ? (
        <NeedsConnection
          onRetry={() => {
            void stats.refetch()
            void thisDay.refetch()
          }}
        />
      ) : (
        // One column up to 840px; from there the stats span the top, the mood calendar sits on the left
        // and On this day on the right. The range toggle belongs to the stats card alone.
        <div className="flex flex-col gap-4 expanded:grid expanded:grid-cols-2 expanded:items-start">
          <section
            aria-label="Stats"
            {...rangeSwipe}
            className="flex flex-col gap-5 overflow-clip rounded-xl bg-surface-container-low p-5 expanded:col-span-2"
          >
            <div className="flex flex-col gap-3 medium:flex-row medium:items-center medium:justify-between">
              <SectionHeader icon="monitoring" title="Stats" />
              <div
                role="radiogroup"
                aria-label="Range"
                data-owns-keys=""
                onKeyDown={radioKeys}
                className="flex rounded-full bg-surface-container-high p-0.5"
              >
                {RANGES.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    role="radio"
                    aria-checked={range === r.value}
                    tabIndex={range === r.value ? 0 : -1}
                    onClick={() => setRange(r.value)}
                    className={cn(
                      'state-layer h-9 flex-1 cursor-pointer rounded-full px-4 text-sm medium:flex-none',
                      range === r.value
                        ? 'bg-secondary-container text-on-secondary-container'
                        : 'text-on-surface-variant',
                    )}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
            {stats.isError && <p role="alert">Couldn’t load the stats.</p>}
            <div ref={rangeRef} className="flex flex-col gap-5">
              <div className={cn('grid gap-y-4', GRID[tiles.length])}>
                {tiles.map((t) => (
                  <Stat key={t.label} {...t} />
                ))}
              </div>
              {stats.data?.topTag && (
                <div className="border-t border-outline-variant pt-3">
                  <Link
                    to={`/?tag=${encodeURIComponent(stats.data.topTag.name)}`}
                    className="state-layer -mx-2 flex items-center gap-3 rounded-lg px-2 py-2"
                  >
                    <Icon name="sell" className="size-5 text-on-surface-variant" />
                    <span className="text-sm text-on-surface-variant">Top tag</span>
                    <span className="min-w-0 flex-1 truncate text-lg">
                      {stats.data.topTag.name}
                    </span>
                    <span className="text-sm text-on-surface-variant">
                      {stats.data.topTag.count}{' '}
                      {stats.data.topTag.count === 1 ? 'entry' : 'entries'}
                    </span>
                    <Icon name="chevron_right" className="size-5 text-on-surface-variant" />
                  </Link>
                </div>
              )}
            </div>
          </section>

          <div className="expanded:col-start-1 expanded:row-start-2">
            <MoodCalendar today={today} />
          </div>

          <section
            aria-label="On this day"
            className="flex flex-col gap-3 expanded:col-start-2 expanded:row-start-2"
          >
            <SectionHeader icon="history" title="On this day" />
            {thisDay.data &&
              (thisDay.data.years.length > 0 ? (
                <OnThisDayYears today={today} years={thisDay.data.years} />
              ) : (
                <EmptyState>No past posts from this day.</EmptyState>
              ))}
          </section>
        </div>
      )}
    </Page>
  )
}

function OnThisDayYears({ today, years }: { today: string; years: OnThisDay['years'] }) {
  const journals = useJournals().data
  const popup = useEntryPopup()
  const wide = usePopupWidth()
  const thisYear = Number(today.slice(0, 4))
  const all = years.flatMap((y) => y.items)
  return (
    <>
      {years.map((y) => (
        <div key={y.year} className="flex flex-col gap-2">
          <h3 className="text-sm text-on-surface-variant">
            {y.year} ({thisYear - y.year === 1 ? '1 year ago' : `${thisYear - y.year} years ago`})
          </h3>
          {y.items.map((item) => (
            <EntryCard
              key={item.id}
              item={item}
              to={`/entry/${item.id}`}
              openedFrom={all}
              onOpen={wide ? () => popup.open(item.id, item) : undefined}
              journal={journalById(journals, item.journalId)}
            />
          ))}
        </div>
      ))}
    </>
  )
}

/** What a day with entries says about itself, for screen readers. */
function dayLabel(d: InsightsMonth['days'][number]) {
  const entries = `${d.entries} ${d.entries === 1 ? 'entry' : 'entries'}`
  const mood = moodByKey(d.mood)
  if (!mood) return `${entries}, no mood`
  return d.moodKinds > 1
    ? `${entries}, mostly ${mood.label.toLowerCase()}, and ${d.moodKinds - 1} other ${d.moodKinds === 2 ? 'mood' : 'moods'}`
    : `${entries}, ${mood.label.toLowerCase()}`
}

/** A soft wash behind a day's emoji: green-ish for good days, red-ish for hard ones, none for neutral. */
function valenceTint(valence: number | null) {
  if (valence === null || Math.abs(valence) < 0.5) return null
  if (valence > 0) return valence >= 1.5 ? 'bg-primary-container/80' : 'bg-primary-container/40'
  return valence <= -1.5 ? 'bg-error-container/50' : 'bg-error-container/25'
}

/** A calendar day's mood emoji, with a hover bubble naming it (the day button carries the accessible name). */
function DayEmoji({ mood, text }: { mood: { emoji: string }; text: string }) {
  const tip = useTip(text)
  return (
    <span aria-hidden="true" className="font-emoji text-3xl leading-none" {...tip.bind}>
      {mood.emoji}
      {tip.node}
    </span>
  )
}

function MoodCalendar({ today }: { today: string }) {
  const navigate = useNavigate()
  const popup = useEntryPopup()
  const wide = usePopupWidth()
  const [thisYear, thisMonth] = today.split('-').map(Number) as [number, number]
  const [shown, setShown] = useState({ year: thisYear, month: thisMonth })
  const [selected, setSelected] = useState<string | null>(null)
  const [keyOpen, setKeyOpen] = useState(false)
  const key = `${shown.year}-${pad(shown.month)}`
  const month = useInsightsMonth(key)
  const { label, weeks } = monthGrid(shown.year, shown.month)
  const atCurrent = key >= today.slice(0, 7)
  const step = (by: number) => {
    const d = new Date(Date.UTC(shown.year, shown.month - 1 + by, 1))
    setShown({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 })
    setSelected(null)
  }
  const days = new Map(month.data?.days.map((d) => [d.day, d]))
  // A swipe on the calendar changes month: left = the next one (not past this month), right = back.
  const { ref: monthRef, swipe } = useSlideSwipe<HTMLDivElement>(
    (direction) => step(direction === 'left' ? 1 : -1),
    (direction) => !(direction === 'left' && atCurrent),
  )

  // Keyboard: [ and ] change month, t returns to this one, ←/→ walk the days with entries.
  useShortcuts([
    { id: 'calendar.month.prev', run: () => step(-1) },
    { id: 'calendar.month.next', when: () => !atCurrent, run: () => step(1) },
    {
      id: 'calendar.today',
      run: () => {
        setShown({ year: thisYear, month: thisMonth })
        setSelected(null)
      },
    },
    { id: 'calendar.next', run: () => moveDay(1) },
    { id: 'calendar.prev', run: () => moveDay(-1) },
  ])

  // A day with one entry opens it; a day with several lists them below the calendar.
  const pick = (d: InsightsMonth['days'][number]) => {
    if (d.entryId) {
      if (wide) popup.open(d.entryId)
      else void navigate(`/entry/${d.entryId}`)
    } else setSelected(d.day)
  }

  return (
    <>
      <section
        aria-label={`Moods, ${label}`}
        {...swipe}
        className="mx-auto w-full max-w-md overflow-clip rounded-xl bg-surface-container-low p-5"
      >
        <div className="mb-3">
          <SectionHeader icon="mood" title="Mood calendar">
            <button
              type="button"
              aria-label="What the moods are"
              onClick={() => setKeyOpen(true)}
              className="state-layer -mr-2 ml-auto grid size-10 place-items-center rounded-full text-on-surface-variant"
            >
              <Icon name="info" className="size-5" />
            </button>
          </SectionHeader>
        </div>
        <div className="mb-4 flex items-center justify-between">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => step(-1)}
            className="state-layer grid size-10 place-items-center rounded-full"
          >
            <Icon name="chevron_left" />
          </button>
          <h3 className="text-lg">{label}</h3>
          <button
            type="button"
            aria-label="Next month"
            disabled={atCurrent}
            onClick={() => step(1)}
            className="state-layer grid size-10 place-items-center rounded-full disabled:opacity-30"
          >
            <Icon name="chevron_right" />
          </button>
        </div>
        {month.isError && (
          <p role="alert" className="mb-2 text-center">
            Couldn’t load this month.
          </p>
        )}
        <div ref={monthRef} className="grid grid-cols-7 gap-y-1 text-center">
          {WEEKDAYS.map((d, i) => (
            <span key={i} aria-hidden="true" className="pb-2 text-sm text-on-surface-variant">
              {d}
            </span>
          ))}
          {weeks.flat().map((day, i) => {
            if (day === null) return <span key={i} />
            const dayStr = `${key}-${pad(day)}`
            const d = days.get(dayStr)
            const mood = moodByKey(d?.mood)
            const cell = cn(
              'mx-auto grid size-11 place-items-center rounded-full',
              dayStr === today && 'ring-2 ring-primary',
              dayStr === selected && 'bg-secondary-container',
            )
            const tint = dayStr === selected ? null : valenceTint(d?.valence ?? null)
            // Rated: the emoji replaces the number. Unrated with entries: the number in a tonal disc.
            if (!d)
              return (
                <span key={i} className={cn(cell, 'text-base text-on-surface-variant')}>
                  {day}
                </span>
              )
            return (
              <button
                key={i}
                type="button"
                data-day=""
                aria-label={`${dayTitle(dayStr)}: ${dayLabel(d)}`}
                onClick={() => pick(d)}
                className={cn(cell, 'state-layer relative cursor-pointer', tint)}
              >
                {mood ? (
                  <DayEmoji
                    mood={mood}
                    text={
                      d.moodKinds > 1
                        ? `${mood.label}, and ${d.moodKinds - 1} other ${d.moodKinds === 2 ? 'mood' : 'moods'}`
                        : mood.label
                    }
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="grid size-9 place-items-center rounded-full bg-primary-container text-base text-on-primary-container"
                  >
                    {day}
                  </span>
                )}
                {d.moodKinds > 1 && (
                  <span
                    aria-hidden="true"
                    className="absolute -top-0.5 -right-0.5 grid size-4 place-items-center rounded-full bg-surface-container-highest text-[10px] leading-none text-on-surface"
                  >
                    +{d.moodKinds - 1}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </section>
      <Dialog open={keyOpen} onClose={() => setKeyOpen(false)} title="Moods" showClose>
        <div className="flex flex-col items-center gap-4">
          <MoodGrid />
          <p className="text-sm text-on-surface-variant">
            Each day shows its most common mood; +1 means there was another. Green days were good,
            red were hard.
          </p>
        </div>
      </Dialog>
      <Dialog
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={dayTitle(selected ?? today)}
        showClose
      >
        {selected && (
          <DayEntries
            day={selected}
            onOpen={wide ? (item) => popup.open(item.id, item) : undefined}
          />
        )}
      </Dialog>
      <EntryPopup />
    </>
  )
}
