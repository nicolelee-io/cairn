import { useLocation } from 'react-router'
import { readPreview } from '../lib/entryPreview.ts'
import { useEntryPopup } from '../lib/entryPopup.ts'
import { EntryReader } from './EntryReader.tsx'
import { Dialog } from './ui/dialog.tsx'

/** The entry opened over the current page (lib/entryPopup.ts); render once on a page that opens entries this way. */
export function EntryPopup() {
  const { id, close } = useEntryPopup()
  const preview = readPreview(useLocation().state)
  return (
    <Dialog
      open={id !== null}
      onClose={close}
      title="Entry"
      bare
      className="w-[min(48rem,calc(100vw-2rem))]"
    >
      {id && <EntryReader id={id} preview={preview} onClose={close} />}
    </Dialog>
  )
}
