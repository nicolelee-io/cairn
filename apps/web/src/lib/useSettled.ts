import { useEffect, useRef } from 'react'

/** Calls `onSettled(value)` once `value` has stopped changing for `delayMs` (always the latest closure). */
export function useSettled<T>(value: T, delayMs: number, onSettled: (value: T) => void) {
  const latest = useRef(onSettled)
  useEffect(() => {
    latest.current = onSettled
  })
  useEffect(() => {
    const t = setTimeout(() => latest.current(value), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])
}
