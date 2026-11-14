import { useMe } from '../auth/useAuth.ts'
import { closeActionDialog, useActionDialog } from '../lib/actionDialog.ts'
import { journalById, useJournals } from '../lib/queries.ts'
import { showToast } from '../lib/toast.ts'
import { useEntryPatch } from '../lib/useEntryPatch.ts'
import { JournalBadge } from './JournalBadge.tsx'
import { JournalDialog } from './JournalDialog.tsx'
import { JournalDeleteDialog, JournalExportDialog } from './JournalConfirmDialogs.tsx'
import { ListRow } from './ListRow.tsx'
import { Button } from './ui/button.tsx'
import { Dialog, DialogActions } from './ui/dialog.tsx'

/** The dialogs the context menus open (lib/actionDialog.ts); one is open at a time. */
export function ActionDialogs() {
  const dialog = useActionDialog()
  const journals = useJournals().data
  const me = useMe().data
  if (!dialog) return null

  if (dialog.kind === 'entry-move') return <MoveEntryDialog {...dialog} />

  const journal = journalById(journals, dialog.journalId)
  if (!journal) return null
  if (dialog.kind === 'journal-export')
    return <JournalExportDialog journal={journal} open onClose={closeActionDialog} />
  if (dialog.kind === 'journal-delete')
    return (
      <JournalDeleteDialog
        journal={journal}
        open
        onClose={closeActionDialog}
        onDeleted={closeActionDialog}
      />
    )
  return (
    <JournalDialog
      key={journal.id}
      journal={journal}
      open
      isDefault={me?.defaultJournalId === journal.id}
      onClose={closeActionDialog}
    />
  )
}

function MoveEntryDialog({
  entryId,
  journalId,
  label,
}: {
  entryId: string
  journalId: string
  label: string
}) {
  const patch = useEntryPatch(entryId)
  const targets = (useJournals().data ?? []).filter((j) => !j.archivedAt && j.id !== journalId)
  return (
    <Dialog open onClose={closeActionDialog} title="Move to journal">
      <p className="truncate text-sm text-on-surface-variant">{label}</p>
      {patch.isError && (
        <p role="alert" className="text-sm text-error">
          Couldn’t move it. Try again.
        </p>
      )}
      <ul className="flex flex-col gap-1">
        {targets.map((j) => (
          <ListRow
            key={j.id}
            as="button"
            disabled={patch.isPending}
            onClick={() =>
              patch.mutate(
                { journalId: j.id },
                {
                  onSuccess: () => {
                    closeActionDialog()
                    showToast(`Moved to ${j.name}`)
                  },
                },
              )
            }
            targetClassName="min-h-12 px-3 py-0"
            lead={<JournalBadge journal={j} />}
            title={j.name}
          />
        ))}
      </ul>
      <DialogActions>
        <Button variant="text" onClick={closeActionDialog}>
          Cancel
        </Button>
      </DialogActions>
    </Dialog>
  )
}
