import { useState } from 'react'
import { Link } from 'react-router'
import { summarize } from '@cairn/shared'
import { useMe } from '../auth/useAuth.ts'
import { EmptyState } from '../components/EmptyState.tsx'
import { ConfirmDialog } from '../components/ui/dialog.tsx'
import { Icon } from '../components/Icon.tsx'
import { clearDraft, type StoredDraft } from '../lib/draft.ts'
import { ago } from '../lib/relativeTime.ts'
import { useDrafts } from '../lib/useDrafts.ts'
import { journalById, useJournals } from '../lib/queries.ts'
import { Page } from './Page.tsx'

/**
 * Unsent changes kept on this device (lib/draft.ts): a new entry, or edits to an existing one.
 * Opening one goes to the editor, which restores it; discarding asks first.
 */
export function DraftsPage() {
  const me = useMe().data
  const drafts = useDrafts(me?.id)
  const journals = useJournals().data
  const [discarding, setDiscarding] = useState<StoredDraft | null>(null)

  return (
    <Page title="Drafts" icon="edit_note">
      {drafts.length === 0 ? (
        <EmptyState>No drafts. Changes you leave unsaved in the editor are kept here.</EmptyState>
      ) : (
        <>
          <p className="text-sm text-on-surface-variant">
            Kept on this device only, until you save or discard them.
          </p>
          <ul className="flex flex-col gap-2">
            {drafts.map((d) => {
              const { title, excerpt } = summarize(d.draft.bodyMd)
              const journal = journalById(journals, d.draft.journalId)
              const isNew = d.draft.baseRev === null
              return (
                <li key={d.target} className="flex items-stretch gap-1">
                  <Link
                    state={{ fromDrafts: true }} // the editor skips its "restored" note
                    to={isNew ? `/new?draft=${d.target}` : `/entry/${d.target}/edit`}
                    className="state-layer flex min-w-0 flex-1 flex-col gap-1 rounded-xl bg-surface-container-low p-4"
                  >
                    <span className="truncate font-semibold">
                      {title || excerpt || 'Empty entry'}
                    </span>
                    {title && excerpt && (
                      <span className="line-clamp-2 font-entry text-sm text-on-surface-variant">
                        {excerpt}
                      </span>
                    )}
                    <span className="flex flex-wrap items-center gap-x-2 text-xs text-on-surface-variant">
                      <span>{isNew ? 'New entry' : 'Edits to an entry'}</span>
                      {journal && <span>· {journal.name}</span>}
                      <span>· saved {ago(d.draft.savedAt)}</span>
                    </span>
                  </Link>
                  <button
                    type="button"
                    aria-label="Discard draft"
                    title="Discard draft"
                    onClick={() => setDiscarding(d)}
                    className="state-layer grid w-12 shrink-0 cursor-pointer place-items-center rounded-xl text-on-surface-variant"
                  >
                    <Icon name="delete" />
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}

      <ConfirmDialog
        open={!!discarding}
        onClose={() => setDiscarding(null)}
        title="Discard this draft?"
        confirmLabel="Discard"
        cancelLabel="Keep"
        onConfirm={() => {
          if (me && discarding) clearDraft(me.id, discarding.target)
          setDiscarding(null)
        }}
      >
        <p className="text-on-surface-variant">The unsaved text and changes will be lost.</p>
      </ConfirmDialog>
    </Page>
  )
}
