import { useSyncExternalStore } from 'react'
import type { Me } from '@cairn/shared'

// Temperatures are stored in °C and shown in the unit on the user's profile (SPEC 4c), so every
// device agrees. This holds the current value for formatTemp(), which isn't a hook: it is set
// whenever `me` is loaded or changed (see auth/useAuth.ts), before anything renders with it.
export type TempUnit = 'F' | 'C'

let current: TempUnit = 'F'
const listeners = new Set<() => void>()

export function applyTempUnit(u: TempUnit) {
  if (u === current) return
  current = u
  listeners.forEach((l) => l())
}

/** Passes `me` through, noting its unit. */
export function withTempUnit<T extends Me | null>(me: T): T {
  if (me) applyTempUnit(me.tempUnit)
  return me
}

export const getTempUnit = () => current

/** Re-renders when the unit changes. */
export function useTempUnit(): TempUnit {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )
}

export const cToUnit = (c: number, u: TempUnit) => (u === 'F' ? (c * 9) / 5 + 32 : c)
export const unitToC = (v: number, u: TempUnit) => (u === 'F' ? ((v - 32) * 5) / 9 : v)
