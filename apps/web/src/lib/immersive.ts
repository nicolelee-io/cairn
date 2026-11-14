import { useSyncExternalStore } from 'react'
import { useBrowseParams } from './useBrowseParams.ts'

// Immersive (zen) view: on a window wide enough for two panes (840px+), hide the entry list (and the
// sidebar from 1200px) so the entry has the whole window. Two kinds:
//  - editing: a per-device preference in localStorage, off by default, that holds from one edit to
//    the next (`setImmersive`, `useImmersive`);
//  - reading: for the entry on screen only, never stored (`setReaderZen`, `useReaderZen`); leaving
//    the reader (Back, the list, the editor) puts it away, `BrowseLayout` does that.
const KEY = 'cairn:immersive'

function stored(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on'
  } catch {
    return false
  }
}

let on = stored()
const listeners = new Set<() => void>()

export function setImmersive(next: boolean) {
  on = next
  try {
    localStorage.setItem(KEY, next ? 'on' : 'off')
  } catch {
    // Not persisted (private window): still applies for this session.
  }
  listeners.forEach((l) => l())
}

export function useImmersive(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => on,
  )
}

let readerZen = false
const readerListeners = new Set<() => void>()

export function setReaderZen(next: boolean) {
  if (readerZen === next) return
  readerZen = next
  readerListeners.forEach((l) => l())
}

export function useReaderZen(): boolean {
  return useSyncExternalStore(
    (l) => {
      readerListeners.add(l)
      return () => readerListeners.delete(l)
    },
    () => readerZen,
  )
}

/** Whether zen mode is hiding the list and sidebar right now: the editor's, or the reader's. */
export function useZenActive(): boolean {
  const { entryId, editing } = useBrowseParams()
  const sticky = useImmersive()
  const reading = useReaderZen()
  return editing ? sticky : !!entryId && reading
}
