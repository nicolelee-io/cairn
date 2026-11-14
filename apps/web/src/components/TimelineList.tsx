import { useInfiniteQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Button } from './ui/button.tsx'
import { openNewJournal } from '../lib/newJournal.ts'
import { EntryCard } from './EntryCard.tsx'
import { EmptyState } from './EmptyState.tsx'
import { Icon } from './Icon.tsx'
import { CairnMark } from './CairnMark.tsx'
import { dayKey, groupTimeline } from '../lib/format.ts'
import { useLoadMore } from '../lib/useLoadMore.ts'
import { useRevealEntry } from '../lib/useRevealEntry.ts'
import { useBrowseParams } from '../lib/useBrowseParams.ts'
import { useInsightsMonths, useJournals } from '../lib/queries.ts'
import { timelineOptions } from '../lib/timeline.ts'
import { LoadingState, Spinner } from './Spinner.tsx'
import { EntryListSkeleton } from './Skeleton.tsx'
import { MonthJumpDialog } from './MonthJumpDialog.tsx'

/** 'March 2023' for a 'YYYY-MM' key. */
const monthName = (key: string) =>
  new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${key}-01T00:00:00Z`),
  )

/** The entry list. Stays mounted beside the reader on wide windows, so it keeps its scroll. */
export function TimelineList() {
  const { journalId, entryId, base } = useBrowseParams()
  const journals = useJournals()
  const tag = useSearchParams()[0].get('tag') || undefined

  const timeline = useInfiniteQuery(timelineOptions(journalId, tag))

  const { hasNextPage, isFetchingNextPage } = timeline
  const sentinel = useLoadMore(timeline)

  const items = useMemo(() => timeline.data?.pages.flatMap((p) => p.items) ?? [], [timeline.data])
  const root = useRef<HTMLDivElement>(null)
  useRevealEntry(root, entryId, {
    ready: timeline.isSuccess,
    items,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage: timeline.fetchNextPage,
  })
  // The server sends pinned entries first, so they are a prefix: a "Pinned" section above the
  // months, since a pinned entry's own month would repeat headers out of order.
  const pinned = useMemo(() => items.filter((i) => i.pinned), [items])
  const months = useMemo(() => groupTimeline(items.filter((i) => !i.pinned)), [items])
  // Month jump: the header opens a picker; the list loads pages until a month at or before the
  // chosen one is on screen (entries run newest first, so nothing nearer can be further down).
  const [picking, setPicking] = useState(false)
  // `n` makes picking the same month twice a new jump.
  const [jump, setJump] = useState<{ month: string; n: number } | null>(null)
  const monthList = useInsightsMonths(journalId, picking)
  // Offline or failed: the months already loaded are what can be jumped to.
  const pickable =
    monthList.data?.months ?? (monthList.isError ? months.map((m) => m.key) : undefined)
  const { fetchNextPage } = timeline
  // The month section to land on: the nearest one at or before the chosen month, once loaded.
  const landing = jump ? months.find((m) => m.key <= jump.month) : undefined
  // Nothing at or before it will ever load (the list has ended): give up and just close.
  const finished = !!jump && (!!landing || !hasNextPage)
  const scrolledFor = useRef<typeof jump>(null)
  useEffect(() => {
    if (!jump || scrolledFor.current === jump) return
    if (!finished) {
      if (!isFetchingNextPage) void fetchNextPage()
      return
    }
    scrolledFor.current = jump
    if (landing)
      root.current
        ?.querySelector<HTMLElement>(`section[data-month="${landing.key}"]`)
        ?.scrollIntoView()
  }, [jump, finished, landing, isFetchingNextPage, fetchNextPage])
  const noJournals = journals.data?.length === 0
  const journalById = useMemo(() => new Map(journals.data?.map((j) => [j.id, j])), [journals.data])

  return (
    <div ref={root} className="flex flex-col gap-2">
      {tag && (
        <div className="flex items-center gap-2">
          <Link
            to={base || '/'}
            aria-label={`Clear tag filter: ${tag}`}
            className="state-layer inline-flex min-h-10 min-w-0 items-center gap-2 rounded-full bg-secondary-container px-3 text-sm text-on-secondary-container"
          >
            <Icon name="sell" filled className="size-5 shrink-0" />
            <span className="truncate">{tag}</span>
            <Icon name="close" className="size-4 shrink-0" />
          </Link>
        </div>
      )}

      {noJournals && (
        <div className="flex flex-col items-center gap-3 rounded-lg bg-surface-container-low p-6 text-center">
          <CairnMark className="size-16" />
          <p className="text-lg">Start by creating a journal.</p>
          <Button onClick={openNewJournal}>Create a journal</Button>
        </div>
      )}

      {jump && !finished && (
        <div
          role="status"
          className="sticky top-27 z-20 flex items-center justify-center gap-2 self-center rounded-full bg-surface-container-high px-4 py-2 text-sm shadow-md"
        >
          <Spinner size="sm" />
          Jumping to {monthName(jump.month)}…
        </div>
      )}

      {timeline.isPending && !noJournals && <EntryListSkeleton />}
      {timeline.isError && (
        <p role="alert">
          Couldn’t load entries.{' '}
          <button className="text-primary underline" onClick={() => void timeline.refetch()}>
            Try again
          </button>
        </p>
      )}
      {timeline.isSuccess && items.length === 0 && !noJournals && (
        <EmptyState>{tag ? `No entries tagged “${tag}”.` : 'No entries here yet.'}</EmptyState>
      )}

      {pinned.length > 0 && (
        <section aria-label="Pinned" className="flex flex-col gap-3">
          <h2 className="sticky top-25 z-10 -mx-4 bg-background/95 px-4 py-2 text-sm font-medium tracking-wide text-primary uppercase backdrop-blur medium:-mx-6 medium:px-6">
            Pinned
          </h2>
          <div className="flex min-w-0 flex-col gap-2">
            {pinned.map((item) => (
              <EntryCard
                key={item.id}
                item={item}
                to={`${base}/entry/${item.id}${tag ? `?tag=${encodeURIComponent(tag)}` : ''}`}
                selected={item.id === entryId}
                journal={journalId ? undefined : journalById.get(item.journalId)}
                showDate
              />
            ))}
          </div>
        </section>
      )}

      {months.map((month) => (
        <section
          key={month.key}
          data-month={month.key}
          aria-label={month.label}
          className="flex scroll-mt-26 flex-col gap-3"
        >
          <h2 className="sticky top-25 z-10 -mx-4 bg-background/95 px-4 py-2 text-sm font-medium tracking-wide text-primary uppercase backdrop-blur medium:-mx-6 medium:px-6">
            <button
              type="button"
              aria-label={`${month.label}: jump to another month`}
              onClick={() => {
                setJump(null)
                setPicking(true)
              }}
              className="inline-flex cursor-pointer items-center gap-1 uppercase"
            >
              {month.label}
              <Icon name="keyboard_arrow_down" className="size-4" />
            </button>
          </h2>
          {month.days.map((day) => {
            // Today in the entries' own zone, matching how the day was grouped.
            const isToday = day.key === dayKey(Date.now(), day.items[0]!.timezone)
            return (
              <div key={day.key} className="grid grid-cols-[2.75rem_1fr] gap-3">
                <div
                  className={`mt-1 flex h-fit flex-col items-center rounded-full py-2.5 leading-tight ${
                    isToday
                      ? 'bg-primary-container text-on-primary-container'
                      : 'bg-surface-container-high'
                  }`}
                  aria-current={isToday ? 'date' : undefined}
                >
                  <div
                    className={`text-[0.65rem] uppercase ${isToday ? '' : 'text-on-surface-variant'}`}
                  >
                    {day.weekday}
                  </div>
                  <div className="text-xl">{day.day}</div>
                </div>
                <div className="flex min-w-0 flex-col gap-2">
                  {day.items.map((item) => (
                    <EntryCard
                      key={item.id}
                      item={item}
                      to={`${base}/entry/${item.id}${tag ? `?tag=${encodeURIComponent(tag)}` : ''}`}
                      selected={item.id === entryId}
                      journal={journalId ? undefined : journalById.get(item.journalId)}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </section>
      ))}

      <MonthJumpDialog
        open={picking && !jump}
        onClose={() => {
          setPicking(false)
          setJump(null)
        }}
        months={pickable}
        onPick={(month) => setJump((j) => ({ month, n: (j?.n ?? 0) + 1 }))}
      />

      <div ref={sentinel} aria-hidden="true" />
      {isFetchingNextPage && <LoadingState label="Loading more" className="py-4" />}
      {timeline.isSuccess && !hasNextPage && items.length > 0 && (
        <div className="flex flex-col items-center gap-2 py-6">
          <CairnMark className="size-8 opacity-60" />
          <p className="text-center text-sm text-on-surface-variant">That’s everything.</p>
        </div>
      )}
    </div>
  )
}
