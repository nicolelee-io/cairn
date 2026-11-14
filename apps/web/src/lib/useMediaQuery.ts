import { useSyncExternalStore } from 'react'

/** Live `matchMedia` result, e.g. useMediaQuery('(min-width: 840px)'). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const m = window.matchMedia(query)
      m.addEventListener('change', notify)
      return () => m.removeEventListener('change', notify)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}
