import { closeNewJournal, useNewJournalOpen } from '../lib/newJournal.ts'
import { JournalDialog } from './JournalDialog.tsx'

/** The New journal dialog, opened from the nav's + or Manage journals, over the current page. */
export function NewJournalDialog() {
  const open = useNewJournalOpen()
  // Mounted only while open, so each time starts blank with the next unused colour picked.
  return open ? (
    <JournalDialog journal={null} open isDefault={false} onClose={closeNewJournal} />
  ) : null
}
