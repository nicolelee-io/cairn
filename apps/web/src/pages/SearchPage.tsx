import { moveCard } from '../lib/cardFocus.ts'
import { useShortcuts } from '../lib/shortcuts.ts'
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { MOODS, SearchPageSchema, type SearchSort } from '@cairn/shared'
import { EntryCard } from '../components/EntryCard.tsx'
import { EmptyState } from '../components/EmptyState.tsx'
import { Icon } from '../components/Icon.tsx'
import { NeedsConnection, OfflineBanner } from '../components/NeedsConnection.tsx'
import { useMe } from '../auth/useAuth.ts'
import { dayKey, plural } from '../lib/format.ts'
import { useOfflineSelection } from '../lib/useSync.ts'
import { Calendar } from '../components/editor/Calendar.tsx'
import { Button } from '../components/ui/button.tsx'
import { Dialog, DialogActions } from '../components/ui/dialog.tsx'
import { Input } from '../components/ui/input.tsx'
import { Select } from '../components/ui/select.tsx'
import { api } from '../lib/api.ts'
import { cn } from '../lib/cn.ts'
import { parseDay } from '../lib/parseDay.ts'
import { autofocusWithMouse } from '../lib/pointer.ts'
import { keys, useJournals, useTags } from '../lib/queries.ts'
import { useServerDown } from '../lib/serverStatus.ts'
import { useLoadMore } from '../lib/useLoadMore.ts'
import { useSettled } from '../lib/useSettled.ts'
import { Page } from './Page.tsx'
import { LoadingState } from '../components/Spinner.tsx'

const PAGE = 20
const TYPING_DELAY_MS = 250

const DAY = /^\d{4}-\d{2}-\d{2}$/

const MOOD_OPTIONS = [
  { value: '', label: 'Any mood' },
  ...MOODS.map((m) => ({ value: m.key, label: m.label, emoji: m.emoji })),
]

const SORTS: { value: SearchSort; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'relevance', label: 'Best match' },
]

/**
 * Full-text search (FTS5 on the server). Everything that shapes the results lives in the URL
 * (?q=&sort=&starred=1&files=1&archived=1&j=&tag=), so a search survives going to an entry and back, and can be
 * bookmarked.
 */
export function SearchPage() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const sort: SearchSort = params.get('sort') === 'relevance' ? 'relevance' : 'newest'
  const starred = params.get('starred') === '1'
  const attachments = params.get('files') === '1'
  const includeArchived = params.get('archived') === '1'
  const journalId = params.get('j') ?? ''
  const tag = params.get('tag') ?? ''
  const mood = MOODS.find((m) => m.key === params.get('mood'))?.key ?? ''
  const from = DAY.test(params.get('from') ?? '') ? params.get('from')! : ''
  const to = DAY.test(params.get('to') ?? '') ? params.get('to')! : ''

  const update = (patch: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const [k, v] of Object.entries(patch)) {
          if (v) next.set(k, v)
          else next.delete(k)
        }
        return next
      },
      { replace: true },
    )

  // The box keeps what was typed; the URL (and so the request) follows once typing pauses.
  const [text, setText] = useState(q)
  useSettled(text, TYPING_DELAY_MS, (settled) => {
    if (settled.trim() !== q.trim()) update({ q: settled.trim() || null })
  })

  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    // A mouse can start typing at once; a phone shouldn't throw the keyboard up unasked.
    if (!q && window.matchMedia('(pointer: fine)').matches) input.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const journals = useJournals()
  const journalById = useMemo(() => new Map(journals.data?.map((j) => [j.id, j])), [journals.data])
  const journalOptions = useMemo(
    () => [
      { value: '', label: 'All journals' },
      ...(journals.data ?? [])
        // Archived journals are choosable once they are included (or already chosen).
        .filter((j) => !j.archivedAt || includeArchived || j.id === journalId)
        .map((j) => ({ value: j.id, label: j.name, dot: j.color ?? '' })),
    ],
    [journals.data, includeArchived, journalId],
  )

  const tagList = useTags().data
  const tagOptions = useMemo(() => {
    const names = (tagList?.tags ?? []).map((t) => t.name)
    // A tag from the URL stays choosable before (or without) the list arriving.
    if (tag && !names.some((n) => n.toLowerCase() === tag.toLowerCase())) names.unshift(tag)
    return [{ value: '', label: 'Any tag' }, ...names.map((n) => ({ value: n, label: n }))]
  }, [tagList, tag])

  // The rarer filters sit behind a toggle, open from the start when one of them is in use.
  const hiddenActive = [attachments, includeArchived, mood !== '', !!from || !!to].filter(
    Boolean,
  ).length
  const [moreOpen, setMoreOpen] = useState(hiddenActive > 0)
  // Every filter in use, shown or hidden: with two or more a Clear filters chip resets them in one
  // tap (the words and the sort stay), and an empty result offers it from one.
  const activeFilters = [
    starred,
    journalId !== '',
    tag !== '',
    attachments,
    includeArchived,
    mood !== '',
    !!from || !!to,
  ].filter(Boolean).length
  const clearFilters = () =>
    update({
      starred: null,
      files: null,
      archived: null,
      j: null,
      tag: null,
      mood: null,
      from: null,
      to: null,
    })

  // Starred, Attachments, a tag, a mood or a date on lists every such entry even with no words typed.
  const searching =
    q.trim() !== '' || starred || attachments || tag !== '' || mood !== '' || !!from || !!to
  const down = useServerDown()
  // Offline, the answer comes from the journals kept on this device (lib/localSearch.ts).
  const kept = useOfflineSelection(useMe().data?.id ?? '')?.ready.length ?? 0
  const search = useInfiniteQuery({
    queryKey: keys.searchResults({
      q,
      sort,
      starred,
      attachments,
      includeArchived,
      journalId,
      tag,
      mood,
      from,
      to,
    }),
    enabled: searching,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ q, sort, limit: String(PAGE) })
      if (starred) qs.set('starred', 'true')
      if (attachments) qs.set('attachments', 'true')
      if (includeArchived) qs.set('includeArchived', 'true')
      if (journalId) qs.set('journalId', journalId)
      if (tag) qs.set('tag', tag)
      if (mood) qs.set('mood', mood)
      if (from) qs.set('from', from)
      if (to) qs.set('to', to)
      if (pageParam) qs.set('cursor', pageParam)
      return api(`/search?${qs}`, { schema: SearchPageSchema })
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData, // keep the old results up while the next ones load
  })
  const sentinel = useLoadMore(search)
  // Keyboard: j and k walk the results (Enter opens the focused one).
  useShortcuts([
    { id: 'search.next', run: () => moveCard(document.querySelector('main'), 1) },
    { id: 'search.prev', run: () => moveCard(document.querySelector('main'), -1) },
  ])

  const items = useMemo(() => search.data?.pages.flatMap((p) => p.items) ?? [], [search.data])

  return (
    <Page title="Search" icon="search">
      {/* Stays under the top bar so only the results scroll: the box alone on a phone (the chips
          would take too much of the screen), the box and the filters from `medium`. */}
      <div
        role="search"
        className="contents medium:sticky medium:top-14 medium:z-10 medium:-mx-8 medium:flex medium:flex-col medium:gap-3 medium:bg-background medium:px-8 medium:pb-2"
      >
        <div className="sticky top-14 z-10 -mx-4 bg-background px-4 pb-2 medium:static medium:z-auto medium:mx-0 medium:bg-transparent medium:p-0">
          <div className="relative">
            <Icon
              name="search"
              className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-on-surface-variant"
            />
            <input
              ref={input}
              type="search"
              aria-label="Search entries"
              placeholder="Search entries"
              enterKeyHint="search"
              autoComplete="off"
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="h-14 w-full rounded-full bg-surface-container-high pr-12 pl-14 text-base outline-none placeholder:text-on-surface-variant focus-visible:outline-2 focus-visible:outline-primary [&::-webkit-search-cancel-button]:hidden"
            />
            {text && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  setText('')
                  update({ q: null })
                  input.current?.focus()
                }}
                className="state-layer absolute top-1/2 right-2 grid size-10 -translate-y-1/2 cursor-pointer place-items-center rounded-full text-on-surface-variant"
              >
                <Icon name="close" />
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <FilterChip
            on={starred}
            icon="star"
            onClick={() => update({ starred: starred ? null : '1' })}
          >
            Starred
          </FilterChip>
          <Select
            label="Journal"
            value={journalId}
            options={journalOptions}
            onChange={(v) => update({ j: v || null })}
            className="max-w-48"
          />
          {(tagOptions.length > 1 || tag) && (
            <Select
              label="Tag"
              value={tag}
              options={tagOptions}
              onChange={(v) => update({ tag: v || null })}
              className="max-w-48"
            />
          )}
          {/* Offline results are always newest first, so the choice would do nothing. */}
          {!down && (
            <Select
              label="Sort"
              value={sort}
              options={SORTS}
              onChange={(v) => update({ sort: v === 'newest' ? null : v })}
            />
          )}
          <button
            type="button"
            aria-expanded={moreOpen}
            aria-controls="more-filters"
            onClick={() => setMoreOpen(!moreOpen)}
            className="state-layer inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-full px-3 text-sm text-on-surface-variant"
          >
            <Icon name="tune" className="size-5" />
            More filters
            {hiddenActive > 0 && (
              <span className="grid size-5 place-items-center rounded-full bg-secondary-container text-xs text-on-secondary-container">
                {hiddenActive}
              </span>
            )}
            <Icon
              name={moreOpen ? 'keyboard_arrow_up' : 'keyboard_arrow_down'}
              className="size-5"
            />
          </button>
          {activeFilters >= 2 && (
            <button
              type="button"
              onClick={clearFilters}
              className="state-layer inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-full px-3 text-sm text-primary"
            >
              <Icon name="close" className="size-5" />
              Clear filters
            </button>
          )}
        </div>
        {moreOpen && (
          <div
            id="more-filters"
            role="group"
            aria-label="More filters"
            className="flex flex-wrap items-center gap-2 border-t border-outline-variant pt-3"
          >
            <FilterChip
              on={attachments}
              icon="attach_file"
              onClick={() => update({ files: attachments ? null : '1' })}
            >
              Attachments
            </FilterChip>
            <FilterChip
              on={includeArchived}
              icon="archive"
              onClick={() => update({ archived: includeArchived ? null : '1' })}
            >
              Include archived
            </FilterChip>
            <Select
              label="Mood"
              value={mood}
              options={MOOD_OPTIONS}
              onChange={(v) => update({ mood: v || null })}
            />
            <DayField label="From" value={from} onChange={(v) => update(dayRange('from', v, to))} />
            <DayField label="To" value={to} onChange={(v) => update(dayRange('to', v, from))} />
          </div>
        )}
      </div>

      {!searching && (
        <p className="rounded-lg bg-surface-container-low p-6 text-on-surface-variant">
          Search your entries, places and tags. Use “quotes” to match an exact phrase.
        </p>
      )}
      {searching && search.isPending && <LoadingState label="Searching" />}
      {searching && search.isSuccess && down && (
        <OfflineBanner centered>
          You’re offline. Searching only the {plural(kept, 'journal', 'journals')} kept on this
          device.
        </OfflineBanner>
      )}
      {searching && search.isError && down && (
        // Nothing kept on this device to search (or this search can't be answered from it).
        <NeedsConnection onRetry={() => void search.refetch()}>
          Search only works on journals kept on this device (Settings &gt; Offline &amp; sync).
        </NeedsConnection>
      )}
      {searching && search.isError && !down && (
        <p role="alert">
          Search failed.{' '}
          <button className="text-primary underline" onClick={() => void search.refetch()}>
            Try again
          </button>
        </p>
      )}
      {searching && search.isSuccess && items.length === 0 && (
        <>
          <EmptyState>
            {q.trim()
              ? `No entries match “${q}”.`
              : tag
                ? `No entries tagged “${tag}”${starred || attachments ? ' with those filters' : ''}.`
                : mood || from || to
                  ? 'No entries match those filters.'
                  : starred && attachments
                    ? 'No starred entries with attachments yet.'
                    : starred
                      ? 'No starred entries yet.'
                      : 'No entries with attachments yet.'}
            {!includeArchived && ' Archived journals aren’t included.'}
          </EmptyState>
          {activeFilters >= 1 && (
            <Button variant="tonal" className="self-center" onClick={clearFilters}>
              Clear filters
            </Button>
          )}
        </>
      )}

      <ul
        aria-label="Results"
        className={cn('flex flex-col gap-2', search.isPlaceholderData && 'opacity-60')}
      >
        {searching &&
          items.map((item) => (
            <li key={item.id}>
              <EntryCard
                item={item}
                snippet={item.snippet}
                snippetField={item.snippetField}
                titleMarked={item.titleMarked}
                showDate
                // The query rides along so the reader can highlight the matches.
                to={q.trim() ? `/entry/${item.id}?q=${encodeURIComponent(q)}` : `/entry/${item.id}`}
                journal={journalById.get(item.journalId)}
              />
            </li>
          ))}
      </ul>

      <div ref={sentinel} aria-hidden="true" />
      {search.isFetchingNextPage && <LoadingState label="Loading more" className="py-4" />}
    </Page>
  )
}

/**
 * A day filter: a chip that shows the day (or just its label) and opens the editor's themed
 * `Calendar` in a dialog; the chip's own X clears it.
 */
function DayField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (day: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [now] = useState(() => Date.now())
  const tz = useMe().data?.defaultTimezone ?? 'UTC'
  const today = dayKey(now, tz)
  return (
    <>
      <span
        className={cn(
          'inline-flex h-10 items-center rounded-full border text-sm',
          value
            ? 'border-transparent bg-secondary-container text-on-secondary-container'
            : 'border-outline-variant text-on-surface-variant',
        )}
      >
        <button
          type="button"
          aria-label={value ? `${label} date: ${dayText(value)}` : `${label} date`}
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
          className="state-layer inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-full pr-3 pl-3 text-sm"
        >
          <Icon name="calendar_month" className="size-5" />
          {value ? `${label} ${dayText(value)}` : label}
        </button>
        {value && (
          <button
            type="button"
            aria-label={`Clear ${label.toLowerCase()} date`}
            onClick={() => onChange(null)}
            className="state-layer -ml-2 grid size-10 cursor-pointer place-items-center rounded-full"
          >
            <Icon name="close" className="size-4" />
          </button>
        )}
      </span>
      <Dialog open={open} onClose={() => setOpen(false)} title={`${label} date`} showClose>
        {open && (
          <DayPicker
            value={value}
            today={today}
            onPick={(day) => {
              onChange(day)
              setOpen(false)
            }}
            onClose={() => setOpen(false)}
          />
        )}
      </Dialog>
    </>
  )
}

/** The dialog's body: a box to type a day in, over the calendar that follows what is typed. */
function DayPicker({
  value,
  today,
  onPick,
  onClose,
}: {
  value: string
  today: string
  onPick: (day: string | null) => void
  onClose: () => void
}) {
  const [text, setText] = useState('')
  const typed = parseDay(text)
  // A hint, not an error: only once the box has been left with something unreadable in it.
  const [left, setLeft] = useState(false)
  const showHint = left && text.trim() !== '' && !typed
  return (
    <div className="flex flex-col gap-4">
      <Calendar value={typed ?? (value || today)} today={today} onChange={onPick} />
      <div className="flex flex-col gap-1">
        <Input
          aria-label="Type a date"
          aria-invalid={showHint}
          data-autofocus={autofocusWithMouse()}
          placeholder="MM/DD/YYYY"
          inputMode="numeric"
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => setLeft(true)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            if (typed) onPick(typed)
          }}
        />
        {showHint && (
          <p role="status" className="px-4 text-sm text-on-surface-variant">
            That isn’t a date. Try 02/15/2026 or 2026-02-15.
          </p>
        )}
      </div>
      <DialogActions>
        {value && (
          <Button variant="text" onClick={() => onPick(null)}>
            Clear
          </Button>
        )}
        <Button variant="text" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!typed} onClick={() => typed && onPick(typed)}>
          Set
        </Button>
      </DialogActions>
    </div>
  )
}

/** 'Nov 8, 2026' for a 'YYYY-MM-DD' day (no zone: the day is a calendar label). */
const dayText = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

/** The URL change for setting one end of the range; an end that would pass the other one is dropped. */
function dayRange(
  end: 'from' | 'to',
  day: string | null,
  other: string,
): Record<string, string | null> {
  const clash = !!day && !!other && (end === 'from' ? day > other : day < other)
  return { [end]: day, ...(clash ? { [end === 'from' ? 'to' : 'from']: null } : {}) }
}

function FilterChip({
  on,
  icon,
  onClick,
  children,
}: {
  on: boolean
  icon: 'star' | 'attach_file' | 'archive'
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'state-layer inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-sm',
        on
          ? 'border-transparent bg-secondary-container text-on-secondary-container'
          : 'border-outline-variant text-on-surface-variant',
      )}
    >
      <Icon name={on ? 'check' : icon} className="size-5" />
      {children}
    </button>
  )
}
