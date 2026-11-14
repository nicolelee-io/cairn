import { useState } from 'react'
import { useMe } from '../auth/useAuth.ts'
import { openActionDialog } from '../lib/actionDialog.ts'
import { dayKey } from '../lib/format.ts'
import { journalWash } from '../lib/journalColors.ts'
import { useJournal, useInsightsDetails } from '../lib/queries.ts'
import { useServerDown } from '../lib/serverStatus.ts'
import { useBrowseParams } from '../lib/useBrowseParams.ts'
import { Button } from './ui/button.tsx'
import { Icon } from './Icon.tsx'
import { NeedsConnection } from './NeedsConnection.tsx'

const ALL_DESCRIPTION = 'Everything you’ve written, across all your journals.'

/** A day key ('YYYY-MM-DD') as "Mar 4, 2026"; it is a calendar date, so no zone applies. */
const dayText = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })

/**
 * The Entries screen's Details view: a card with the journal's description (All Entries has a
 * default one; a journal without one offers to add it) over the numbers the server works out
 * (Day One's info view, and the only place the description shows on a phone). The description
 * comes from the journal list, so it shows offline.
 */
export function DetailsView() {
  const { journalId } = useBrowseParams()
  const journal = useJournal(journalId)
  const me = useMe().data
  const tz = me?.defaultTimezone ?? 'UTC'
  const showStreak = me?.showStreak ?? true
  const showBest = showStreak && (me?.showBestStreak ?? true)
  const [now] = useState(() => Date.now())
  const down = useServerDown()
  const details = useInsightsDetails(dayKey(now, tz), journalId)
  const d = details.data
  const counts = [
    { label: 'Entries', value: d?.entries },
    { label: 'Days', value: d?.days },
    { label: 'Media', value: d?.media },
  ]
  const more = [
    { label: 'Words', value: d?.words },
    ...(showStreak ? [{ label: 'Streak', value: d?.currentStreak }] : []),
    ...(showBest ? [{ label: 'Best streak', value: d?.longestStreak }] : []),
  ]
  const tiles = (items: { label: string; value: number | undefined }[]) => (
    <dl className="grid grid-cols-3 gap-2">
      {items.map((s) => (
        <div key={s.label} className="flex flex-col gap-1 rounded-2xl bg-surface-container-low p-3">
          <dt className="text-sm text-on-surface-variant">{s.label}</dt>
          <dd className="text-2xl">{s.value?.toLocaleString() ?? '–'}</dd>
        </div>
      ))}
    </dl>
  )

  // A single journal waits for the list to load; All Entries has no journal to wait for.
  const showHeader = !journalId || !!journal
  return (
    <div className="flex flex-col gap-3 pt-2">
      {showHeader && (
        <section
          aria-label="Description"
          className="flex items-center gap-3 rounded-2xl bg-surface-container-low p-4"
          style={{ background: journalWash(journal?.color, 'surface-container-low', 14) }}
        >
          <Icon name="edit_note" className="size-6 shrink-0 text-on-surface-variant" />
          <div className="min-w-0 flex-1">
            {!journal ? (
              <p>{ALL_DESCRIPTION}</p>
            ) : journal.description ? (
              <p className="whitespace-pre-line">{journal.description}</p>
            ) : journal.archivedAt ? (
              <p className="text-on-surface-variant">No description.</p>
            ) : (
              <Button
                variant="text"
                className="-mx-3"
                onClick={() => openActionDialog({ kind: 'journal-edit', journalId: journal.id })}
              >
                Add a description
              </Button>
            )}
          </div>
        </section>
      )}
      {down ? (
        <NeedsConnection onRetry={() => void details.refetch()} />
      ) : details.isError ? (
        <p role="alert">Couldn’t load the details.</p>
      ) : (
        <>
          {tiles(counts)}
          {tiles(more)}
          {d?.firstDay && d.lastDay && (
            <dl className="grid grid-cols-2 gap-2">
              {[
                { label: 'First entry', day: d.firstDay },
                { label: 'Latest entry', day: d.lastDay },
              ].map((s) => (
                <div
                  key={s.label}
                  className="flex flex-col gap-1 rounded-2xl bg-surface-container-low p-3"
                >
                  <dt className="text-sm text-on-surface-variant">{s.label}</dt>
                  <dd>{dayText(s.day)}</dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}
    </div>
  )
}
