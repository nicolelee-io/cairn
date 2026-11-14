import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import type { Journal } from '@cairn/shared'
import { useMe, useUpdateMe } from '../auth/useAuth.ts'
import { openActionDialog } from './actionDialog.ts'
import { copyText } from './clipboard.ts'
import type { MenuAction } from './contextMenu.ts'
import { updateJournal } from './journalWrites.ts'
import { invalidateAfterSave, invalidateMe, journalById, useJournals } from './queries.ts'
import { useServerDown } from './serverStatus.ts'
import { withoutMedia } from './templateText.ts'
import { showToast } from './toast.ts'
import { useDeleteEntry } from './trash.ts'
import { useEntryPatch } from './useEntryPatch.ts'

const NEEDS_CONNECTION = 'Needs a connection'

/** Starts a download of a same-origin URL (the server names the file) without leaving the page. */
export function downloadFile(url: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = ''
  a.click()
}

/** The actions of a journal's context menu, built on demand (lib/contextMenu.ts `useMenuTrigger`). */
export function useJournalMenu(journal: Journal, onNavigate?: () => void): () => MenuAction[] {
  const qc = useQueryClient()
  const me = useMe().data
  const updateMe = useUpdateMe()
  const navigate = useNavigate()
  const down = useServerDown()
  const archive = useMutation({
    mutationFn: (archived: boolean) => updateJournal(me?.id, journal.id, { archived }),
    onSuccess: (_j, archived) => {
      invalidateAfterSave(qc)
      invalidateMe(qc)
      showToast(archived ? 'Journal archived' : 'Journal unarchived')
    },
    onError: () => showToast('Couldn’t change the journal'),
  })

  return () => {
    const archived = !!journal.archivedAt
    const needsServer = down ? NEEDS_CONNECTION : undefined
    const list: MenuAction[] = []
    if (!archived) {
      list.push({
        id: 'new',
        label: 'New entry here',
        icon: 'add',
        run: () => {
          onNavigate?.()
          void navigate(`/j/${journal.id}/new`)
        },
      })
      if (me?.defaultJournalId !== journal.id)
        list.push({
          id: 'default',
          label: 'Make default for new entries',
          icon: 'check',
          run: () => updateMe.mutate({ defaultJournalId: journal.id }),
        })
    }
    list.push(
      {
        id: 'edit',
        label: 'Edit…',
        icon: 'edit',
        run: () => openActionDialog({ kind: 'journal-edit', journalId: journal.id }),
      },
      {
        id: 'export',
        label: 'Export…',
        icon: 'download',
        disabled: needsServer,
        run: () => openActionDialog({ kind: 'journal-export', journalId: journal.id }),
      },
      {
        id: 'archive',
        label: archived ? 'Unarchive' : 'Archive',
        icon: archived ? 'unarchive' : 'archive',
        run: () => archive.mutate(!archived),
      },
      {
        id: 'delete',
        label: 'Delete…',
        icon: 'delete',
        destructive: true,
        run: () => openActionDialog({ kind: 'journal-delete', journalId: journal.id }),
      },
    )
    return list
  }
}

/** What the entry menu needs to know about an entry (a list card and the open reader both have it). */
export interface MenuEntry {
  id: string
  journalId: string
  pinned: boolean
  starred: boolean
  /** The title, or the start of the text; named in the dialogs. */
  label: string
  /** The text, when the caller has it (the open reader; a card doesn't): it adds Copy markdown. */
  bodyMd?: string
}

/**
 * The actions of an entry's context menu (no Open: tapping the row is that). `editTo` is the
 * editor's URL. Changes in an archived journal are not offered (it is read-only). `omit` leaves
 * out actions the caller already shows as buttons (the reader's Edit, Pin and Star).
 */
export function useEntryMenu(
  entry: MenuEntry,
  { editTo, omit = [] }: { editTo: string; omit?: string[] },
): () => MenuAction[] {
  const navigate = useNavigate()
  const journals = useJournals().data
  const patch = useEntryPatch(entry.id)
  const deleteEntry = useDeleteEntry()
  const down = useServerDown()

  return () => {
    const journal = journalById(journals, entry.journalId)
    const readOnly = !!journal?.archivedAt
    const list: MenuAction[] = []
    // Reading and exporting are fine in an archived journal; only changes are not offered.
    const exportAction: MenuAction = {
      id: 'export',
      label: 'Export',
      icon: 'download',
      disabled: down ? NEEDS_CONNECTION : undefined,
      run: () => downloadFile(`/api/export/entries/${entry.id}`),
    }
    // Same for copying the text out.
    const copyAction: MenuAction | undefined =
      entry.bodyMd === undefined
        ? undefined
        : {
            id: 'copy',
            label: 'Copy markdown',
            icon: 'content_copy',
            // Photos and files are references to this server's files, so they stay behind.
            run: () =>
              void copyText(withoutMedia(entry.bodyMd ?? '')).then((ok) =>
                showToast(ok ? 'Copied to clipboard' : 'Couldn’t copy'),
              ),
          }
    const reading = [copyAction, exportAction].filter((a) => !!a)
    if (readOnly) return reading.filter((a) => !omit.includes(a.id))
    list.push(
      {
        id: 'edit',
        label: 'Edit',
        icon: 'edit',
        run: () => void navigate(editTo, { state: { fromReader: true } }),
      },
      {
        id: 'pin',
        label: entry.pinned ? 'Unpin' : 'Pin',
        icon: 'keep',
        run: () => patch.mutate({ pinned: !entry.pinned }),
      },
      {
        id: 'star',
        label: entry.starred ? 'Remove star' : 'Star',
        icon: 'star',
        run: () => patch.mutate({ starred: !entry.starred }),
      },
    )
    if (journals?.some((j) => !j.archivedAt && j.id !== entry.journalId))
      list.push({
        id: 'move',
        label: 'Move to journal…',
        icon: 'drive_file_move',
        run: () =>
          openActionDialog({
            kind: 'entry-move',
            entryId: entry.id,
            journalId: entry.journalId,
            label: entry.label,
          }),
      })
    list.push(...reading)
    // No confirmation: it goes to the trash, and the toast offers Undo.
    list.push({
      id: 'delete',
      label: 'Delete',
      icon: 'delete',
      destructive: true,
      run: () => void deleteEntry(entry.id, entry.label),
    })
    return list.filter((a) => !omit.includes(a.id))
  }
}

const QUICK_JOURNALS = 4

/** The journals the New entry button offers on a long press: the first few active ones in the order Manage journals shows. */
export function quickJournals(journals: Journal[], n = QUICK_JOURNALS): Journal[] {
  const active = journals
    .filter((j) => !j.archivedAt)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt)
  // With one journal there is nothing to choose.
  return active.length < 2 ? [] : active.slice(0, n)
}

/** The New entry button's long-press menu: one row per journal; `current` is where a plain tap goes. */
export function useNewEntryMenu(current: string | undefined): () => MenuAction[] {
  const navigate = useNavigate()
  const journals = useJournals().data
  const me = useMe().data
  return () =>
    quickJournals(journals ?? []).map((j) => ({
      id: j.id,
      label: j.name,
      icon: 'edit',
      dot: j.color ?? '',
      checked: j.id === (current ?? me?.defaultJournalId),
      run: () => void navigate(`/j/${j.id}/new`),
    }))
}
