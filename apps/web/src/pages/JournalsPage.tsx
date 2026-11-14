import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type ComponentProps } from 'react'
import { Link } from 'react-router'
import type { Journal } from '@cairn/shared'
import { useMe } from '../auth/useAuth.ts'
import { Icon } from '../components/Icon.tsx'
import { JournalDialog } from '../components/JournalDialog.tsx'
import { TopLink } from '../components/TopLink.tsx'
import { Button } from '../components/ui/button.tsx'
import { reorderJournals } from '../lib/journalWrites.ts'
import { cn } from '../lib/cn.ts'
import { useMenuTrigger } from '../lib/contextMenu.ts'
import { useJournalMenu } from '../lib/menuActions.ts'
import { keys, useJournals } from '../lib/queries.ts'
import { useTrashCount } from '../lib/trash.ts'
import { useReorder } from '../lib/useReorder.ts'
import { openNewJournal } from '../lib/newJournal.ts'
import { JournalBadge } from '../components/JournalBadge.tsx'
import { Page } from './Page.tsx'
import { LoadingState } from '../components/Spinner.tsx'

/** A journal's row, with the journal context menu on right-click and long-press. */
function JournalItem({ journal, ...props }: { journal: Journal } & ComponentProps<'li'>) {
  const trigger = useMenuTrigger(useJournalMenu(journal), journal.name)
  return <li {...trigger} {...props} />
}

export function JournalsPage() {
  const journals = useJournals()
  const me = useMe().data
  // The journal being edited; creating goes through the same dialog the nav's + uses.
  const [selected, setSelected] = useState<Journal | null>(null)

  const qc = useQueryClient()
  const active = journals.data?.filter((j) => !j.archivedAt) ?? []
  const archived = journals.data?.filter((j) => j.archivedAt) ?? []
  const trashCount = useTrashCount().data
  const trashed = trashCount ? trashCount.entries + trashCount.journals : 0

  // The new order goes into the cache at once; a failure re-reads the server's.
  const saveOrder = useMutation({
    // Offline it waits in the outbox (null): the cache already has the order from onMutate.
    mutationFn: (ids: string[]) => reorderJournals(me?.id, ids),
    onMutate: (ids) => {
      qc.setQueryData<Journal[]>(keys.journals, (old) =>
        old
          ?.map((j) => (ids.includes(j.id) ? { ...j, sortOrder: ids.indexOf(j.id) } : j))
          .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt),
      )
    },
    onError: () => void qc.invalidateQueries({ queryKey: keys.journals }),
    onSuccess: (list) => list && qc.setQueryData(keys.journals, list),
  })
  const reorder = useReorder(
    active.map((j) => j.id),
    (ids) => saveOrder.mutate(ids),
  )
  const byId = new Map(active.map((j) => [j.id, j]))
  const ordered = reorder.order.flatMap((id) => byId.get(id) ?? [])

  // Tapping a journal edits it; the chevron opens its entries; the grip reorders (drag it, or
  // focus it and use the up and down arrow keys).
  const row = (j: Journal, sortable = false) => (
    <JournalItem
      key={j.id}
      journal={j}
      ref={sortable ? reorder.rowRef(j.id) : undefined}
      style={sortable ? reorder.style(j.id) : undefined}
      className={cn(
        'relative flex items-center gap-1 rounded-lg bg-surface-container-low pr-1',
        reorder.draggingId === j.id && 'bg-surface-container-high shadow-md',
      )}
    >
      {sortable && active.length > 1 && (
        <button
          type="button"
          aria-label={`Reorder ${j.name}`}
          title="Drag, or use the up and down arrow keys"
          className="state-layer grid size-10 shrink-0 cursor-grab touch-none place-items-center rounded-full text-on-surface-variant active:cursor-grabbing"
          {...reorder.handleProps(j.id)}
        >
          <Icon name="drag_indicator" />
        </button>
      )}
      <button
        type="button"
        onClick={() => setSelected(j)}
        aria-label={`Edit ${j.name}`}
        className="state-layer flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-3 text-left"
      >
        <JournalBadge journal={j} />
        <span className="min-w-0 flex-1 truncate">{j.name}</span>
        {me?.defaultJournalId === j.id && (
          <span className="rounded-sm bg-primary-container px-2 py-0.5 text-xs text-on-primary-container">
            Default
          </span>
        )}
        <span className="text-sm text-on-surface-variant">{j.entryCount}</span>
      </button>
      <TopLink
        to={`/j/${j.id}`}
        aria-label={`Open ${j.name} entries`}
        className="state-layer grid size-10 shrink-0 place-items-center rounded-full text-on-surface-variant"
      >
        <Icon name="chevron_right" />
      </TopLink>
    </JournalItem>
  )

  return (
    <Page title="Manage journals" icon="auto_stories" back>
      {journals.isPending && <LoadingState />}
      {journals.isError && <p role="alert">Couldn’t load journals.</p>}

      {journals.data && (
        <>
          <Button className="self-start" onClick={openNewJournal}>
            <Icon name="add" className="size-5" />
            New journal
          </Button>

          {active.length === 0 && (
            <p className="rounded-lg bg-surface-container-low p-4 text-on-surface-variant">
              No journals yet. Create one to start writing.
            </p>
          )}
          <ul className="flex flex-col gap-2">{ordered.map((j) => row(j, true))}</ul>
          {saveOrder.isError && <p role="alert">Couldn’t save the new order. Try again.</p>}

          {archived.length > 0 && (
            <details className="group">
              <summary className="state-layer flex cursor-pointer list-none items-center gap-2 rounded-full px-2 py-2 text-on-surface-variant">
                <Icon name="chevron_right" className="transition-transform group-open:rotate-90" />
                Archived ({archived.length})
              </summary>
              <ul className="mt-2 flex flex-col gap-2">{archived.map((j) => row(j))}</ul>
            </details>
          )}
          {/* Where a deleted journal is looked for. */}
          <Link
            to="/trash"
            className="state-layer flex items-center gap-2 self-start rounded-full px-2 py-2 text-on-surface-variant"
          >
            <Icon name="delete" />
            Trash{trashed ? ` (${trashed})` : ''}
          </Link>
        </>
      )}

      <JournalDialog
        // Keyed so each journal opens with fresh form state.
        key={selected?.id ?? 'none'}
        journal={selected}
        open={selected !== null}
        isDefault={selected !== null && me?.defaultJournalId === selected.id}
        onClose={() => setSelected(null)}
      />
    </Page>
  )
}
