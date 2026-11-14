import { useSyncExternalStore } from 'react'

// Whether the editor shows a word count under the text: a per-device preference in localStorage,
// off unless switched on.
const KEY = 'cairn:word-count'

function stored(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on'
  } catch {
    return false
  }
}

let shown = stored()
const listeners = new Set<() => void>()

export function setWordCount(on: boolean) {
  shown = on
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {
    // Not persisted (private window): still applies for this session.
  }
  listeners.forEach((l) => l())
}

export function useWordCount(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => shown,
  )
}
