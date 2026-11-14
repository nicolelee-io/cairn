import { Link, useSearchParams } from 'react-router'
import { useMe } from '../auth/useAuth.ts'
import { EntryEditor } from '../components/editor/EntryEditor.tsx'
import { buttonVariants } from '../components/ui/button.tsx'
import { useJournals } from '../lib/queries.ts'
import { useBrowseParams } from '../lib/useBrowseParams.ts'
import { Page } from './Page.tsx'

/** New entry: a blank editor (or, with `?draft=`, that kept draft) writing to the journal being browsed, else the default. */
export function NewEntryPage() {
  const me = useMe().data
  const journals = useJournals()
  const params = useSearchParams()[0]
  // The journal being browsed (/j/:id/new); `?j=` is the older spelling.
  const requested = useBrowseParams().journalId ?? params.get('j')
  const draftId = params.get('draft') ?? undefined
  // `?prompt=` starts the entry from a writing prompt (Prompts page); a kept draft wins over it.
  const prompt = (!draftId && params.get('prompt')) || undefined
  if (!journals.data || !me) return <Page title="New entry" />
  const active = journals.data.filter((j) => !j.archivedAt)
  const target =
    active.find((j) => j.id === requested) ?? active.find((j) => j.id === me.defaultJournalId)

  if (!target) {
    return (
      <Page title="New entry">
        <div className="flex flex-col items-start gap-3 rounded-lg bg-surface-container-low p-4">
          <p>You need an active journal before you can write.</p>
          <Link to="/journals" className={buttonVariants()}>
            Manage journals
          </Link>
        </div>
      </Page>
    )
  }
  return (
    <EntryEditor
      key={draftId ?? prompt ?? 'new'}
      userId={me.id}
      journals={active}
      source={{ kind: 'new', journalId: target.id, draftId, prompt }}
    />
  )
}
