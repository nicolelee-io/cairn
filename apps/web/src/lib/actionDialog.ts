import { useSyncExternalStore } from 'react'

/**
 * The dialog a context-menu action opens (edit, export or delete a journal; move an entry; an
 * entry's delete needs none, see lib/trash.ts). A store because the menu's rows live in lists that come and go; rendered once, in AppShell,
 * by components/ActionDialogs.tsx. Only ids are kept, so the dialog reads the current data.
 */
export type ActionDialog =
  | { kind: 'journal-edit' | 'journal-export' | 'journal-delete'; journalId: string }
  | { kind: 'entry-move'; entryId: string; journalId: string; label: string }

let current: ActionDialog | null = null
const listeners = new Set<() => void>()
const set = (d: ActionDialog | null) => {
  current = d
  listeners.forEach((l) => l())
}

export const openActionDialog = (d: ActionDialog) => set(d)
export const closeActionDialog = () => set(null)
export const useActionDialog = (): ActionDialog | null =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    () => current,
  )
