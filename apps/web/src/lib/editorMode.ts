import { useCallback, useState } from 'react'

// Whether the editor shows plain markdown instead of styling it in place: a per-device choice
// (localStorage), off by default. It is the way out if the styled view misbehaves with some keyboard.
const KEY = 'cairn:editor-source'

export function useSourceMode(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(KEY) === '1'
    } catch {
      return false
    }
  })
  const set = useCallback((next: boolean) => {
    setOn(next)
    try {
      localStorage.setItem(KEY, next ? '1' : '0')
    } catch {
      // Not persisted (private window): still applies until the editor closes.
    }
  }, [])
  return [on, set]
}
