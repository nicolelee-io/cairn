import { useLocation, useParams } from 'react-router'
import { EntryReader } from '../components/EntryReader.tsx'
import { EntrySwipe } from '../components/EntrySwipe.tsx'
import { readPreview } from '../lib/entryPreview.ts'

/** The `/entry/:id` route; the reader itself is `EntryReader`, which the Insights popup shares. */
export function EntryPage() {
  const { id = '' } = useParams()
  return (
    <EntrySwipe id={id}>
      <EntryReader id={id} preview={readPreview(useLocation().state)} />
    </EntrySwipe>
  )
}
