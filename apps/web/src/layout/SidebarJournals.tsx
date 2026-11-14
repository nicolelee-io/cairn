import type { Journal } from '@cairn/shared'
import { useMe } from '../auth/useAuth.ts'
import { Icon } from '../components/Icon.tsx'
import { JournalBadge } from '../components/JournalBadge.tsx'
import { TopLink } from '../components/TopLink.tsx'
import { cn } from '../lib/cn.ts'
import { journalWash } from '../lib/journalColors.ts'
import { useMenuTrigger } from '../lib/contextMenu.ts'
import { useJournalMenu } from '../lib/menuActions.ts'
import { openNewJournal } from '../lib/newJournal.ts'
import { useJournals } from '../lib/queries.ts'
import { useBrowseParams } from '../lib/useBrowseParams.ts'

function Row({
  journal,
  selected,
  onNavigate,
}: {
  journal: Journal
  selected: boolean
  onNavigate?: () => void
}) {
  const trigger = useMenuTrigger(useJournalMenu(journal, onNavigate), journal.name)
  return (
    <TopLink
      to={`/j/${journal.id}`}
      {...trigger}
      onClick={onNavigate}
      aria-current={selected ? 'page' : undefined}
      className={cn(
        'state-layer flex h-10 items-center gap-3 rounded-full px-4 text-sm [-webkit-touch-callout:none]',
        selected
          ? cn('text-on-secondary-container', !journal.color && 'bg-secondary-container')
          : 'text-on-surface-variant',
      )}
      style={
        selected ? { background: journalWash(journal.color, 'secondary-container', 30) } : undefined
      }
    >
      {/* Same 24px cell as a nav icon, so the names line up with Entries, Search and the rest. */}
      {/* 28px in a 24px cell: the extra is taken from both sides so the names still line up. */}
      <JournalBadge journal={journal} className="-mx-0.5" />
      <span className="min-w-0 flex-1 truncate">{journal.name}</span>
      <span className="text-xs">{journal.entryCount}</span>
    </TopLink>
  )
}

/** The journal list, directly under Entries, Insights and Search (in the sidebar and in the drawer). */
export function SidebarJournals({ onNavigate }: { onNavigate?: () => void }) {
  const journals = useJournals().data
  const showArchived = useMe().data?.showArchivedInMenu ?? true
  const { journalId } = useBrowseParams()
  // Still loading: nothing yet. With no journals the header and + stay, so the first one can be made from the menu.
  if (!journals) return null
  const active = journals.filter((j) => !j.archivedAt)
  const archived = showArchived ? journals.filter((j) => j.archivedAt) : []
  const archivedSelected = archived.some((j) => j.id === journalId)

  return (
    <div className="flex flex-col gap-1 pt-3 large:min-h-0">
      <div className="flex items-center justify-between pr-1 pl-4">
        <h2 className="text-xs font-medium tracking-wide text-on-surface-variant uppercase">
          Journals
        </h2>
        <button
          type="button"
          onClick={() => {
            onNavigate?.() // closes the drawer; the dialog is rendered by AppShell
            openNewJournal()
          }}
          aria-label="New journal"
          className="state-layer grid size-8 cursor-pointer place-items-center rounded-full text-on-surface-variant"
        >
          <Icon name="add" className="size-5" />
        </button>
      </div>
      {/* The rows scroll on their own in the permanent sidebar; the "Journals" header stays. */}
      <div className="flex flex-col gap-1 large:-my-1 large:min-h-0 large:overflow-y-auto large:py-1">
        {active.map((j) => (
          <Row key={j.id} journal={j} selected={j.id === journalId} onNavigate={onNavigate} />
        ))}
        {archived.length > 0 && (
          // Remounted when the selection moves into the group, so it opens for a selected archive.
          <details key={String(archivedSelected)} open={archivedSelected} className="group">
            <summary className="state-layer flex h-10 cursor-pointer list-none items-center gap-3 rounded-full px-4 text-sm text-on-surface-variant">
              <span className="grid size-6 shrink-0 place-items-center">
                <Icon name="archive" className="size-5" />
              </span>
              <span className="flex-1">Archived ({archived.length})</span>
              <Icon
                name="keyboard_arrow_down"
                className="size-5 transition-transform group-open:rotate-180"
              />
            </summary>
            <div className="flex flex-col gap-1 pt-1">
              {archived.map((j) => (
                <Row key={j.id} journal={j} selected={j.id === journalId} onNavigate={onNavigate} />
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  )
}
