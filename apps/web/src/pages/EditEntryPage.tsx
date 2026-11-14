import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { useMe } from '../auth/useAuth.ts'
import { EntryEditor } from '../components/editor/EntryEditor.tsx'
import { buttonVariants } from '../components/ui/button.tsx'
import { ApiError } from '../lib/api.ts'
import { fetchEntry } from '../lib/outbox.ts'
import { keys, useJournals } from '../lib/queries.ts'
import { useBrowseParams } from '../lib/useBrowseParams.ts'
import { LoadingState } from '../components/Spinner.tsx'

const message =
  'mx-auto flex w-full max-w-(--content-w) flex-col items-start gap-4 px-4 pt-4 medium:px-8'

/** Edit an existing entry. Entries in an archived journal are read-only, so they don't open here. */
export function EditEntryPage() {
  const { id = '' } = useParams()
  const me = useMe().data
  const journals = useJournals()
  const { base } = useBrowseParams()
  const query = useQuery({
    queryKey: keys.entry(id),
    queryFn: () => fetchEntry(id),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
  })

  if (query.isError) {
    const gone = query.error instanceof ApiError && query.error.status === 404
    return (
      <div className={message}>
        <p role="alert">{gone ? 'This entry doesn’t exist.' : 'Couldn’t load this entry.'}</p>
      </div>
    )
  }
  if (!query.data || !journals.data || !me) {
    return <LoadingState className="medium:px-8" />
  }

  const entry = query.data.entry
  const active = journals.data.filter((j) => !j.archivedAt)
  if (!active.some((j) => j.id === entry.journalId)) {
    return (
      <div className={message}>
        <p role="alert">This entry is in an archived journal, so it can’t be edited.</p>
        <Link to={`${base}/entry/${id}`} replace className={buttonVariants({ variant: 'tonal' })}>
          Back to the entry
        </Link>
      </div>
    )
  }
  return (
    <EntryEditor
      key={id}
      userId={me.id}
      journals={active}
      source={{ kind: 'edit', detail: query.data }}
    />
  )
}
