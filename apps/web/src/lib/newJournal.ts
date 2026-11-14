import { useSyncExternalStore } from 'react'

// Whether the New journal dialog is open. It is a store because the nav's + (also inside the
// slide-out drawer, which unmounts as it closes) and Manage journals both open it, and it is
// rendered once, in AppShell, over whatever page is showing.
let open = false
const listeners = new Set<() => void>()
const set = (v: boolean) => {
  open = v
  listeners.forEach((l) => l())
}

export const openNewJournal = () => set(true)
export const closeNewJournal = () => set(false)
export const useNewJournalOpen = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    () => open,
  )
