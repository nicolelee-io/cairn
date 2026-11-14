// The reading font and size for entry text (the editor and reader), a per-device setting (screens
// differ, so a phone and a laptop want different sizes). Applied as `--font-entry` and
// `--entry-scale` on <html>; index.css reads both. Only the chosen font's files are fetched (a
// dynamic import per font, each its own CSS chunk). The choice lives in localStorage and is applied
// as this module loads, so the page doesn't paint in Literata first.
import { useSyncExternalStore } from 'react'
import {
  ENTRY_FONTS,
  ENTRY_TEXT_SCALE,
  ENTRY_TEXT_SIZES,
  type EntryFont,
  type EntryTextSize,
} from '@cairn/shared'

export const ENTRY_FONT_OPTIONS: { value: EntryFont; label: string; stack: string }[] = [
  {
    value: 'literata',
    label: 'Literata',
    stack: "'Literata Variable', Georgia, 'Noto Serif', serif",
  },
  { value: 'lora', label: 'Lora', stack: "'Lora Variable', Georgia, 'Noto Serif', serif" },
  {
    value: 'source-serif',
    label: 'Source Serif',
    stack: "'Source Serif 4 Variable', Georgia, 'Noto Serif', serif",
  },
  {
    value: 'atkinson',
    label: 'Atkinson Hyperlegible',
    stack: "'Atkinson Hyperlegible', system-ui, sans-serif",
  },
  { value: 'inter', label: 'Inter', stack: "'Inter Variable', system-ui, sans-serif" },
]

export const ENTRY_SIZE_OPTIONS: { value: EntryTextSize; label: string }[] = [
  { value: 'small', label: 'Small' },
  { value: 'default', label: 'Default' },
  { value: 'large', label: 'Large' },
  { value: 'larger', label: 'Larger' },
]

const loaders: Record<EntryFont, () => Promise<unknown>> = {
  literata: () =>
    Promise.all([
      import('@fontsource-variable/literata/wght.css'),
      import('@fontsource-variable/literata/wght-italic.css'),
    ]),
  lora: () =>
    Promise.all([
      import('@fontsource-variable/lora/wght.css'),
      import('@fontsource-variable/lora/wght-italic.css'),
    ]),
  'source-serif': () =>
    Promise.all([
      import('@fontsource-variable/source-serif-4/wght.css'),
      import('@fontsource-variable/source-serif-4/wght-italic.css'),
    ]),
  atkinson: () =>
    Promise.all([
      import('@fontsource/atkinson-hyperlegible/400.css'),
      import('@fontsource/atkinson-hyperlegible/400-italic.css'),
      import('@fontsource/atkinson-hyperlegible/700.css'),
      import('@fontsource/atkinson-hyperlegible/700-italic.css'),
    ]),
  inter: () =>
    Promise.all([
      import('@fontsource-variable/inter/wght.css'),
      import('@fontsource-variable/inter/wght-italic.css'),
    ]),
}

// "font,size": the same key and format as when this was mirrored from the account, so a device
// keeps the choice it was already showing.
const KEY = 'cairn:entry-text'
const loaded = new Set<EntryFont>()

export interface EntryText {
  font: EntryFont
  size: EntryTextSize
}

function stored(): EntryText {
  try {
    const [font, size] = (localStorage.getItem(KEY) ?? '').split(',')
    return {
      font: ENTRY_FONTS.find((f) => f === font) ?? 'literata',
      size: ENTRY_TEXT_SIZES.find((s) => s === size) ?? 'default',
    }
  } catch {
    return { font: 'literata', size: 'default' }
  }
}

let current = stored()
const listeners = new Set<() => void>()

function apply({ font, size }: EntryText) {
  const root = document.documentElement
  const stack = ENTRY_FONT_OPTIONS.find((o) => o.value === font)?.stack
  if (stack) root.style.setProperty('--font-entry', stack)
  root.style.setProperty('--entry-scale', String(ENTRY_TEXT_SCALE[size]))
  if (!loaded.has(font)) {
    loaded.add(font)
    // On failure (offline, never cached) the fallback in the stack shows; try again next time.
    loaders[font]().catch(() => loaded.delete(font))
  }
}

/** Sets the font (fetching its files the first time) and size, and remembers them on this device. */
export function setEntryText(next: Partial<EntryText>) {
  current = { ...current, ...next }
  apply(current)
  try {
    localStorage.setItem(KEY, `${current.font},${current.size}`)
  } catch {
    // Private mode: the setting still applies, it just isn't remembered across loads.
  }
  listeners.forEach((l) => l())
}

export function useEntryText(): EntryText {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )
}

apply(current)
