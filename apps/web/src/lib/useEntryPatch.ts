import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { EntryDetail } from '@cairn/shared'
import { useMe } from '../auth/useAuth.ts'
import { sendOrQueue, withPendingEdits } from './outbox.ts'
import { keys } from './queries.ts'

/** The quick changes made without opening the editor. */
export interface EntryPatch {
  starred?: boolean
  pinned?: boolean
  journalId?: string
  /** The whole text, for the reader's tickable checklists (one box flipped). Needs `baseRev`. */
  bodyMd?: string
  /** Leave out where the entry isn't open (a list card): these fields aren't text, so no conflict. */
  baseRev?: number
}

/**
 * A quick change to one entry (star, pin, move to another journal), shared by the reader's buttons
 * and the context menus. Offline it is queued like any other save and shows at once (lib/outbox.ts).
 */
export function useEntryPatch(id: string) {
  const qc = useQueryClient()
  const me = useMe().data
  const entryKey = keys.entry(id)
  return useMutation({
    mutationFn: (v: EntryPatch) =>
      sendOrQueue(me?.id ?? '', {
        method: 'PATCH',
        path: `/entries/${id}`,
        body: v as Record<string, unknown>,
        entryId: id,
        target: id,
        draft: null,
      }),
    onSuccess: async (detail: EntryDetail | null) => {
      if (!detail) {
        const cached = qc.getQueryData<EntryDetail>(entryKey)
        if (cached && me) qc.setQueryData(entryKey, await withPendingEdits(me.id, cached))
        void qc.invalidateQueries({ queryKey: keys.entries })
        return
      }
      qc.setQueryData(entryKey, detail)
      void qc.invalidateQueries({ queryKey: keys.entries })
      void qc.invalidateQueries({ queryKey: keys.search })
      void qc.invalidateQueries({ queryKey: keys.journals }) // a move changes two counts
    },
    // A conflict (edited elsewhere) or any failure: show what the server has now.
    onError: () => void qc.invalidateQueries({ queryKey: entryKey }),
  })
}
