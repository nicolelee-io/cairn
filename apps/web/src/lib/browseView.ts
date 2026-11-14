import { useSyncExternalStore } from 'react'

// How the Entries screen shows its entries: the details, the list, the calendar, the media grid or the map.
// A per-device preference in localStorage, like the theme; it holds across opening entries, so the
// map stays beside the reader instead of turning back into the list.
export const BROWSE_VIEWS = ['details', 'list', 'calendar', 'media', 'map'] as const
export type BrowseView = (typeof BROWSE_VIEWS)[number]
const KEY = 'cairn:browse-view'

function stored(): BrowseView {
  try {
    const v = localStorage.getItem(KEY)
    return BROWSE_VIEWS.find((x) => x === v) ?? 'list'
  } catch {
    return 'list'
  }
}

let current = stored()
const listeners = new Set<() => void>()

export function setBrowseView(v: BrowseView) {
  current = v
  try {
    localStorage.setItem(KEY, v)
  } catch {
    // Not persisted (private window): still applies for this session.
  }
  listeners.forEach((l) => l())
}

export function useBrowseView(): BrowseView {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )
}

// Where the page (the window, on a phone) was scrolled to in each view, so a view you come back to
// is where you left it and one view's scrolling never moves another's. Not persisted.
// Per journal too (undefined = All Entries): a calendar's height and current month differ by journal.
const scrolls = new Map<string, number>()
const scrollKey = (v: BrowseView, journalId?: string) => `${v}:${journalId ?? ''}`
export const savedScroll = (v: BrowseView, journalId?: string) =>
  scrolls.get(scrollKey(v, journalId))
export const saveScroll = (v: BrowseView, journalId: string | undefined, y: number) =>
  void scrolls.set(scrollKey(v, journalId), y)
