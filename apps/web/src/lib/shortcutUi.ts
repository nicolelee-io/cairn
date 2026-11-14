import { useSyncExternalStore } from 'react'

// Whether the shortcut help dialog and the command palette are open. Stores because the keys,
// the Settings rows and the menu all open them, and each renders once, in AppShell (ShortcutHost).
function flag() {
  let open = false
  const listeners = new Set<() => void>()
  const set = (v: boolean) => {
    if (v === open) return
    open = v
    listeners.forEach((l) => l())
  }
  const use = () =>
    useSyncExternalStore(
      (l) => {
        listeners.add(l)
        return () => void listeners.delete(l)
      },
      () => open,
    )
  return { set, use, get: () => open }
}

const palette = flag()

// The help dialog opens on what applies to the screen, or on everything (from Settings, where
// nothing else would apply).
interface HelpState {
  open: boolean
  all: boolean
}
let helpState: HelpState = { open: false, all: false }
const helpListeners = new Set<() => void>()
const setHelp = (next: HelpState) => {
  helpState = next
  helpListeners.forEach((l) => l())
}

export const openShortcutHelp = (all = false) => setHelp({ open: true, all })
export const closeShortcutHelp = () => setHelp({ ...helpState, open: false })
export const useShortcutHelp = () =>
  useSyncExternalStore(
    (l) => {
      helpListeners.add(l)
      return () => void helpListeners.delete(l)
    },
    () => helpState,
  )

export const openPalette = () => palette.set(true)
export const closePalette = () => palette.set(false)
export const useIsPaletteOpen = palette.use
