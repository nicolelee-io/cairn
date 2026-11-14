import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type MouseEvent, type ReactNode } from 'react'
import { entryLabel, type Journal, type TrashEntry, type TrashJournal } from '@cairn/shared'
import { useMe } from '../auth/useAuth.ts'
import { Icon } from '../components/Icon.tsx'
import { JournalBadge } from '../components/JournalBadge.tsx'
import { ListRow } from '../components/ListRow.tsx'
import { NeedsConnection } from '../components/NeedsConnection.tsx'
import { LoadingState } from '../components/Spinner.tsx'
import { Button } from '../components/ui/button.tsx'
import { ConfirmDialog } from '../components/ui/dialog.tsx'
import { kindOf, cancelQueuedDelete, waitingDeletes } from '../lib/outbox.ts'
import type { OutboxRow } from '../lib/localDb.ts'
import { useOutboxState } from '../lib/useOutbox.ts'
import { invalidateAfterSave } from '../lib/queries.ts'
import { openMenuFrom, useMenuTrigger, type MenuAction } from '../lib/contextMenu.ts'
import { errorCode } from '../lib/api.ts'
import { plural, shortDate } from '../lib/format.ts'
import { photoUrl } from '../lib/photos.ts'
import { useJournal } from '../lib/queries.ts'
import { ago } from '../lib/relativeTime.ts'
import { useServerDown } from '../lib/serverStatus.ts'
import { showToast } from '../lib/toast.ts'
import {
  emptyTrash,
  invalidateAfterTrash,
  purgeEntry,
  purgeJournal,
  restoreEntry,
  restoreJournal,
  useTrashEntries,
  useTrashJournals,
} from '../lib/trash.ts'
import { useLoadMore } from '../lib/useLoadMore.ts'
import { useMediaQuery } from '../lib/useMediaQuery.ts'
import { Page } from './Page.tsx'

const DAY_MS = 24 * 60 * 60 * 1000

/** "57 days left · deleted 3 days ago": when it goes for good (first, it matters most), and when it went. */
export function deletedLine(deletedAt: number, purgeAt: number) {
  const left = Math.ceil((purgeAt - Date.now()) / DAY_MS)
  return `${left <= 0 ? 'Goes today' : `${plural(left, 'day', 'days')} left`} · deleted ${ago(deletedAt)}`
}

/** What "Delete forever" is about to remove, for its confirmation. */
export type Doomed =
  | { kind: 'entry'; id: string; label: string }
  | { kind: 'journal'; id: string; label: string; entries: number }
  | { kind: 'all' }

/**
 * Trash (`/trash`): deleted entries and journals, kept for the server's retention. Restore brings
 * one back; Delete forever and Empty trash confirm first. Needs the server, like Manage tags.
 */
export function TrashPage() {
  const down = useServerDown()
  const days = useMe().data?.trashRetentionDays ?? 60
  const entries = useTrashEntries()
  const journals = useTrashJournals()
  const [doomed, setDoomed] = useState<Doomed | null>(null)
  const items = entries.data?.pages.flatMap((p) => p.items) ?? []
  const trashedJournals = journals.data?.journals ?? []
  const empty = items.length === 0 && trashedJournals.length === 0

  return (
    <Page title="Trash" icon="delete" back>
      <WaitingDeletes />
      {down ? (
        <NeedsConnection
          onRetry={() => {
            void entries.refetch()
            void journals.refetch()
          }}
        />
      ) : entries.isPending || journals.isPending ? (
        <LoadingState label="Loading Trash" />
      ) : entries.isError || journals.isError ? (
        <p role="alert">Couldn’t load Trash.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-sm text-on-surface-variant">
              Deleted entries and journals stay here for {days} days, then are deleted for good.
            </p>
            <Button variant="outlined" disabled={empty} onClick={() => setDoomed({ kind: 'all' })}>
              Empty Trash
            </Button>
          </div>
          {empty ? (
            <div className="flex flex-col items-center gap-2 py-16 text-on-surface-variant">
              <Icon name="delete" className="size-10" />
              <p>Nothing in Trash</p>
            </div>
          ) : (
            <>
              {trashedJournals.length > 0 && (
                <Section title="Journals">
                  {trashedJournals.map((j) => (
                    <JournalRow key={j.id} journal={j} onPurge={setDoomed} />
                  ))}
                </Section>
              )}
              {items.length > 0 && (
                <Section title="Entries">
                  {items.map((e) => (
                    <EntryRow key={e.id} entry={e} onPurge={setDoomed} />
                  ))}
                </Section>
              )}
              <LoadMore query={entries} />
            </>
          )}
        </>
      )}
      {doomed && <PurgeDialog doomed={doomed} onClose={() => setDoomed(null)} />}
    </Page>
  )
}

/**
 * Deletes made while the server couldn't be reached (they leave the screen at once and go to the
 * trash when the connection is back): listed here so they can still be taken back.
 */
function WaitingDeletes() {
  const me = useMe().data
  const qc = useQueryClient()
  const { pending } = useOutboxState()
  const [rows, setRows] = useState<OutboxRow[]>([])
  useEffect(() => {
    if (!me) return
    let live = true
    void waitingDeletes(me.id).then((r) => live && setRows(r))
    return () => void (live = false)
  }, [me, pending])
  if (!me || rows.length === 0) return null
  return (
    <Section title="Waiting to move to Trash">
      {rows.map((r) => {
        const journal = kindOf(r) === 'delete-journal'
        return (
          <ListRow
            key={r.entryId}
            lead={
              <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-surface-container text-on-surface-variant">
                <Icon name={journal ? 'auto_stories' : 'book'} />
              </span>
            }
            title={r.label ?? (journal ? 'Journal' : 'Entry')}
            lines={[journal ? 'Journal' : 'Entry', 'Moves to Trash once you’re back online']}
            trailing={
              <Button
                variant="text"
                size="sm"
                onClick={() =>
                  void cancelQueuedDelete(me.id, r.entryId).then((ok) => {
                    if (!ok) return
                    invalidateAfterSave(qc)
                    showToast(journal ? 'Journal kept' : 'Entry kept')
                  })
                }
              >
                Undo
              </Button>
            }
          />
        )
      })}
    </Section>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-1">
      <h2 className="px-1 text-sm font-medium text-on-surface-variant">{title}</h2>
      <ul className="flex flex-col divide-y divide-outline-variant rounded-lg bg-surface-container-low">
        {children}
      </ul>
    </section>
  )
}

function LoadMore({ query }: { query: ReturnType<typeof useTrashEntries> }) {
  const sentinel = useLoadMore(query)
  return (
    <div ref={sentinel}>
      {query.isFetchingNextPage && <LoadingState label="Loading more" className="py-4" />}
    </div>
  )
}

/**
 * The ⋮ / long-press menu: Delete forever, plus Restore while the row has no Restore button of its
 * own (below `medium`), so the menu never repeats a button beside it.
 */
function useRowActions(restore: () => void, purge: () => void) {
  const restoreButton = useMediaQuery('(min-width: 600px)')
  return (): MenuAction[] => [
    ...(restoreButton
      ? []
      : [{ id: 'restore', label: 'Restore', icon: 'undo' as const, run: restore }]),
    { id: 'purge', label: 'Delete forever…', icon: 'delete', destructive: true, run: purge },
  ]
}

function Row({
  lead,
  title,
  lines,
  menuTitle,
  build,
  restoring,
  onRestore,
  to,
}: {
  lead: ReactNode
  title: string
  lines: string[]
  menuTitle: string
  build: () => MenuAction[]
  restoring: boolean
  onRestore: () => void
  /** Tapping the text opens this (an entry's reader) instead of the menu. */
  to?: string
}) {
  const trigger = useMenuTrigger(build, menuTitle)
  const openMenu = (e: MouseEvent<HTMLElement>) => openMenuFrom(e.currentTarget, build, menuTitle)
  // A journal row's text opens the menu on a phone (no room for a Restore button beside it); from
  // `medium` Restore is a button of its own. An entry row opens its reader, which has both.
  return (
    <ListRow
      {...(to
        ? { as: 'link' as const, to }
        : { as: 'button' as const, popup: true, onClick: openMenu })}
      liProps={trigger}
      targetClassName="pr-0"
      lead={lead}
      title={title}
      lines={lines}
      trailing={
        <>
          <Button
            variant="text"
            size="sm"
            className="hidden medium:inline-flex"
            disabled={restoring}
            onClick={onRestore}
          >
            Restore
          </Button>
          <Button
            variant="text"
            size="icon"
            aria-label={`More actions for ${menuTitle}`}
            aria-haspopup="menu"
            onClick={openMenu}
          >
            <Icon name="more_vert" />
          </Button>
        </>
      }
    />
  )
}

/** Restoring reports what came back, or why it can't yet. */
export function useRestore(fn: () => Promise<unknown>, done: string, journal?: Journal) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      invalidateAfterTrash(qc)
      showToast(done)
    },
    onError: (e) => {
      if (errorCode(e) === 'journal_archived')
        showToast(`Unarchive ${journal?.name ?? 'its journal'} first`, {
          label: 'Journals',
          to: '/journals',
        })
      else showToast('Couldn’t restore. Try again.')
      invalidateAfterTrash(qc)
    },
  })
}

function EntryRow({ entry, onPurge }: { entry: TrashEntry; onPurge: (d: Doomed) => void }) {
  const journal = useJournal(entry.journalId)
  const label = entryLabel(entry)
  const restore = useRestore(() => restoreEntry(entry.id), 'Entry restored', journal)
  const build = useRowActions(
    () => restore.mutate(),
    () => onPurge({ kind: 'entry', id: entry.id, label }),
  )
  const thumb = entry.photos[0]
  return (
    <Row
      lead={
        thumb ? (
          <img
            src={photoUrl(thumb.id, 'thumb')}
            alt=""
            className="size-12 shrink-0 rounded-md object-cover"
          />
        ) : (
          <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-surface-container text-on-surface-variant">
            <Icon name="book" />
          </span>
        )
      }
      title={label}
      lines={[
        [journal?.name, shortDate(entry.createdAt, entry.timezone)].filter(Boolean).join(' · '),
        deletedLine(entry.deletedAt, entry.purgeAt),
      ]}
      menuTitle={label}
      build={build}
      restoring={restore.isPending}
      onRestore={() => restore.mutate()}
      to={`/trash/${entry.id}`}
    />
  )
}

function JournalRow({ journal, onPurge }: { journal: TrashJournal; onPurge: (d: Doomed) => void }) {
  const restore = useRestore(() => restoreJournal(journal.id), `${journal.name} restored`)
  const build = useRowActions(
    () => restore.mutate(),
    () =>
      onPurge({
        kind: 'journal',
        id: journal.id,
        label: journal.name,
        entries: journal.entryCount,
      }),
  )
  return (
    <Row
      lead={
        <span className="flex size-12 shrink-0 items-center justify-center">
          <JournalBadge journal={journal} size="md" />
        </span>
      }
      title={journal.name}
      lines={[
        plural(journal.entryCount, 'entry', 'entries'),
        deletedLine(journal.deletedAt, journal.purgeAt),
      ]}
      menuTitle={journal.name}
      build={build}
      restoring={restore.isPending}
      onRestore={() => restore.mutate()}
    />
  )
}

export function PurgeDialog({
  doomed,
  onClose,
  onDone,
}: {
  doomed: Doomed
  onClose: () => void
  /** After it is gone, e.g. to leave the page that showed it. */
  onDone?: () => void
}) {
  const qc = useQueryClient()
  const purge = useMutation({
    mutationFn: () =>
      doomed.kind === 'entry'
        ? purgeEntry(doomed.id)
        : doomed.kind === 'journal'
          ? purgeJournal(doomed.id)
          : emptyTrash(),
    onSuccess: () => {
      invalidateAfterTrash(qc)
      onClose()
      onDone?.()
      showToast(doomed.kind === 'all' ? 'Trash emptied' : 'Deleted for good')
    },
  })
  const title =
    doomed.kind === 'all'
      ? 'Empty Trash?'
      : doomed.kind === 'journal'
        ? `Delete “${doomed.label}” forever?`
        : 'Delete this entry forever?'
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title={title}
      confirmLabel={doomed.kind === 'all' ? 'Empty Trash' : 'Delete forever'}
      confirmIcon="delete"
      pending={purge.isPending}
      error={purge.error && 'Couldn’t delete. Try again.'}
      onConfirm={() => purge.mutate()}
    >
      {doomed.kind === 'entry' && (
        <p className="truncate text-sm text-on-surface-variant">{doomed.label}</p>
      )}
      <p className="text-on-surface-variant">
        {doomed.kind === 'all'
          ? 'Everything in Trash is deleted for good, with its photos and files.'
          : doomed.kind === 'journal'
            ? `The journal and its ${plural(doomed.entries, 'entry', 'entries')} are deleted for good, with their photos and files.`
            : 'The entry is deleted for good, with its photos and files.'}{' '}
        This can&apos;t be undone.
      </p>
    </ConfirmDialog>
  )
}
