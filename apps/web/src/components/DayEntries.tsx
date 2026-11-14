import type { TimelineItem } from '@cairn/shared'
import { journalById, useInsightsDay, useJournals } from '../lib/queries.ts'
import { EntryCard } from './EntryCard.tsx'
import { EntryListSkeleton } from './Skeleton.tsx'

export const dayTitle = (day: string) =>
  new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`))

/** The entries written on one day (in each entry's own zone), as cards. */
export function DayEntries({
  day,
  journalId,
  base = '',
  onOpen,
}: {
  day: string
  /** Only this journal's entries (the Entries calendar); omit for all. */
  journalId?: string
  /** The list's own path, so an entry opens beside the list it came from. */
  base?: string
  /** Open an entry in a popup instead of navigating to it. */
  onOpen?: (item: TimelineItem) => void
}) {
  const { data, isError } = useInsightsDay(day, journalId)
  const journals = useJournals().data
  return (
    <div className="flex flex-col gap-2">
      {!data && !isError && <EntryListSkeleton count={2} />}
      {isError && <p role="alert">Couldn’t load this day.</p>}
      {data?.items.map((item) => (
        <EntryCard
          key={item.id}
          item={item}
          to={`${base}/entry/${item.id}`}
          onOpen={onOpen && (() => onOpen(item))}
          journal={journalId ? undefined : journalById(journals, item.journalId)}
        />
      ))}
    </div>
  )
}
