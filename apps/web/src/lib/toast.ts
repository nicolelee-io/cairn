import { useSyncExternalStore } from 'react'

/** A link to another screen, or a button (Undo) that runs something. */
export type ToastAction = { label: string; to: string } | { label: string; onClick: () => void }

/** A short message at the bottom of the screen, optionally with one link or button. */
export interface Toast {
  id: number
  text: string
  action?: ToastAction
}

const SHOW_MS = 3000
/** A toast with a button stays a little longer: there is time to reach it. */
const SHOW_WITH_BUTTON_MS = 6000
let current: Toast | null = null
let nextId = 1
let timer: ReturnType<typeof setTimeout> | undefined
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function dismissToast() {
  clearTimeout(timer)
  current = null
  emit()
}

/** Shows `text`, replacing any toast already up. */
export function showToast(text: string, action?: ToastAction) {
  clearTimeout(timer)
  current = { id: nextId++, text, action }
  timer = setTimeout(dismissToast, action && 'onClick' in action ? SHOW_WITH_BUTTON_MS : SHOW_MS)
  emit()
}

export function useToast(): Toast | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current,
  )
}
