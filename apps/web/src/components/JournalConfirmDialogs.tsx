import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Journal } from '@cairn/shared'
import { useMe } from '../auth/useAuth.ts'
import { api } from '../lib/api.ts'
import { plural } from '../lib/format.ts'
import { sendOrQueueWrite } from '../lib/outbox.ts'
import { showToast } from '../lib/toast.ts'
import { invalidateAfterTrash } from '../lib/trash.ts'
import { ExportControls } from './ExportControls.tsx'
import { Button } from './ui/button.tsx'
import { ConfirmDialog, Dialog, DialogActions } from './ui/dialog.tsx'

/** Export one journal. Shared by the journal's edit dialog and the journal context menu. */
export function JournalExportDialog({
  journal,
  open,
  onClose,
}: {
  journal: Journal
  open: boolean
  onClose: () => void
}) {
  return (
    <Dialog open={open} onClose={onClose} title={`Export “${journal.name}”`}>
      <ExportControls journalId={journal.id} />
      <DialogActions>
        <Button variant="text" onClick={onClose}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  )
}

/** The confirmation before a journal and its entries go to the trash (it takes them all). */
export function JournalDeleteDialog({
  journal,
  open,
  onClose,
  onDeleted,
}: {
  journal: Journal
  open: boolean
  onClose: () => void
  onDeleted: () => void
}) {
  const qc = useQueryClient()
  const me = useMe().data
  const days = me?.trashRetentionDays ?? 60
  const remove = useMutation({
    // Offline it waits in the outbox; the journal list hides it meanwhile (lib/outbox.ts).
    mutationFn: async () => {
      if (!me) return void (await api(`/journals/${journal.id}`, { method: 'DELETE' }))
      await sendOrQueueWrite(me.id, {
        kind: 'delete-journal',
        id: journal.id,
        method: 'DELETE',
        path: `/journals/${journal.id}`,
        label: journal.name,
      })
    },
    onSuccess: () => {
      invalidateAfterTrash(qc)
      onDeleted()
      showToast('Journal moved to Trash', { label: 'View', to: '/trash' })
    },
  })
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title={`Delete “${journal.name}”?`}
      confirmLabel="Delete"
      pending={remove.isPending}
      error={remove.error && 'Couldn’t delete. Try again.'}
      onConfirm={() => remove.mutate()}
    >
      <p className="text-on-surface-variant">
        {journal.entryCount === 0
          ? 'This moves the journal to Trash. It has no entries.'
          : `This moves the journal and its ${plural(journal.entryCount, 'entry', 'entries')} to Trash.`}{' '}
        You can restore them from there for {days} days. Archive it instead if you only want it out
        of the way.
      </p>
    </ConfirmDialog>
  )
}
