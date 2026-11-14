// Light, dark or follow the system. The choice is a per-device preference (localStorage), applied as
// `data-theme` on <html>, which theme.css turns into the palette; "system" removes the attribute so
// prefers-color-scheme decides. The address-bar colour (index.html's theme-color metas) is kept in
// step by switching which of the two applies.
import { useSyncExternalStore } from 'react'

export type ThemeMode = 'system' | 'light' | 'dark'
const KEY = 'cairn:theme'
const root = document.documentElement
const metas = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map(
  (m) => ({ el: m, media: m.media }),
)

function stored(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

function apply(mode: ThemeMode) {
  if (mode === 'system') root.removeAttribute('data-theme')
  else root.dataset.theme = mode
  // The metas are [light, dark]. A forced mode keeps only its own.
  metas.forEach(({ el, media }, i) => {
    el.media = mode === 'system' ? media : (mode === 'light') === (i === 0) ? 'all' : 'not all'
  })
}
// Applied as this module loads, before the app's first paint.
apply(stored())

const listeners = new Set<() => void>()

export function setThemeMode(mode: ThemeMode) {
  try {
    if (mode === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, mode)
  } catch {
    // Not persisted (private window): still applies for this session.
  }
  apply(mode)
  listeners.forEach((l) => l())
}

export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () =>
      root.dataset.theme === 'light' || root.dataset.theme === 'dark'
        ? root.dataset.theme
        : 'system',
  )
}
