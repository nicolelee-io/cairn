import { useSyncExternalStore } from 'react'

// Whether the Entries/Insights bottom bar shows below 1200px: a per-device preference in
// localStorage, shown unless switched off. Without it, those two are in the menu like the rest.
const KEY = 'cairn:bottom-bar'

function stored(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}

let shown = stored()
const listeners = new Set<() => void>()

export function setBottomBar(on: boolean) {
  shown = on
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {
    // Not persisted (private window): still applies for this session.
  }
  listeners.forEach((l) => l())
}

export function useBottomBar(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => shown,
  )
}
