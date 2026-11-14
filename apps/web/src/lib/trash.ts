import { useInfiniteQuery, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router'
import {
  JournalSchema,
  TrashCountSchema,
  TrashRestoredEntrySchema,
  TrashEntriesPageSchema,
  TrashEntryDetailSchema,
  TrashJournalsSchema,
  TrashPurgedSchema,
  TrashSettingsSchema,
} from '@cairn/shared'
import { useMe } from '../auth/useAuth.ts'
import { api } from './api.ts'
import { deleteEntryOrQueue, isUnreachable } from './outbox.ts'
import { parentOf } from './navigation.ts'
import { invalidateAfterSave, invalidateMe, keys } from './queries.ts'
import { showToast } from './toast.ts'

// Deleted entries and journals go to the trash (server: repo/trash.ts) for the server's retention
// (`me.trashRetentionDays`). Everything here needs the server; nothing is queued offline.

const PAGE = 50

/** One trashed entry in full, to read before restoring it. */
export function useTrashEntry(id: string) {
  return useQuery({
    queryKey: keys.trashEntry(id),
    queryFn: () => api(`/trash/entries/${id}`, { schema: TrashEntryDetailSchema }),
    retry: false,
  })
}

/** Entries in the trash whose journal is live, most recently deleted first. */
export function useTrashEntries() {
  return useInfiniteQuery({
    queryKey: keys.trashEntries,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ limit: String(PAGE) })
      if (pageParam) qs.set('cursor', pageParam)
      return api(`/trash/entries?${qs}`, { schema: TrashEntriesPageSchema })
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
  })
}

export function useTrashJournals() {
  return useQuery({
    queryKey: keys.trashJournals,
    queryFn: () => api('/trash/journals', { schema: TrashJournalsSchema }),
    retry: false,
  })
}

/** How many items the Trash page lists, for the Settings row. */
export function useTrashCount() {
  return useQuery({
    queryKey: keys.trashCount,
    queryFn: () => api('/trash/count', { schema: TrashCountSchema }),
    retry: false,
  })
}

/** The server's retention setting (admins only). */
export function useTrashSettings(enabled = true) {
  return useQuery({
    queryKey: keys.adminTrash,
    queryFn: () => api('/admin/trash', { schema: TrashSettingsSchema }),
    enabled,
  })
}

/** After anything left or entered the trash: lists, counts, journals and storage. */
export function invalidateAfterTrash(qc: QueryClient) {
  invalidateAfterSave(qc)
  invalidateMe(qc)
  void qc.invalidateQueries({ queryKey: keys.storage })
}

export const restoreEntry = (id: string) =>
  api(`/trash/entries/${id}/restore`, { method: 'POST', schema: TrashRestoredEntrySchema })
export const restoreJournal = (id: string) =>
  api(`/trash/journals/${id}/restore`, { method: 'POST', schema: JournalSchema })
export const purgeEntry = (id: string) => api(`/trash/entries/${id}`, { method: 'DELETE' })
export const purgeJournal = (id: string) =>
  api(`/trash/journals/${id}`, { method: 'DELETE', schema: TrashPurgedSchema })
export const emptyTrash = () => api('/trash', { method: 'DELETE', schema: TrashPurgedSchema })

/**
 * Deletes an entry straight away (it goes to the trash, so there is no confirmation) and offers
 * Undo. Deleting the entry that is open leaves its reader for the list.
 */
export function useDeleteEntry() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const me = useMe().data
  return async (entryId: string, label = 'Entry') => {
    let waiting: Awaited<ReturnType<typeof deleteEntryOrQueue>> = { queued: false }
    try {
      if (me) waiting = await deleteEntryOrQueue(me.id, entryId, label)
      else await api(`/entries/${entryId}`, { method: 'DELETE' })
    } catch {
      showToast('Couldn’t delete. Try again.')
      return
    }
    if (pathname.includes(`/entry/${entryId}`)) void navigate(parentOf(pathname), { replace: true })
    qc.removeQueries({ queryKey: keys.entry(entryId) })
    invalidateAfterTrash(qc)
    showToast('Moved to Trash', {
      label: 'Undo',
      onClick: async () => {
        // Still waiting to be sent: just take it back out of the queue.
        if (waiting.queued && (await waiting.undo())) {
          invalidateAfterTrash(qc)
          showToast('Entry restored')
          return
        }
        restoreEntry(entryId).then(
          () => {
            invalidateAfterTrash(qc)
            showToast('Entry restored')
          },
          (e) =>
            showToast(
              isUnreachable(e)
                ? 'Restore it from Trash once you’re back online.'
                : 'Couldn’t restore. It is in Trash.',
              { label: 'View', to: '/trash' },
            ),
        )
      },
    })
  }
}
