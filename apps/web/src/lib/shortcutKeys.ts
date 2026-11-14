/*
 * Pure key matching and labels for the shortcut registry (lib/shortcuts.ts).
 *
 * A shortcut's keys are a sequence of steps separated by spaces: "n", "g e" (press g, then e),
 * "Mod+Shift+F". A step is modifiers joined with "+" and then a key. `Mod` is Ctrl, or Cmd on a
 * Mac. Letters and digits written with Mod or Alt are matched on the physical key (`event.code`),
 * because Option+letter types a different character on a Mac and Shift+8 is "*" on `event.key`.
 * Everything else is matched on `event.key`, so "?" works on any layout.
 */

export interface Step {
  mod: boolean
  alt: boolean
  shift: boolean
  key: string
}

export type KeyEventLike = Pick<
  KeyboardEvent,
  'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'
>

export function parseStep(step: string): Step {
  const parts = step.split('+')
  // A trailing "+" is the plus key itself ("Mod++").
  const key = step.endsWith('+') ? '+' : (parts.pop() ?? '')
  const mods = step.endsWith('+') ? parts.slice(0, -1) : parts
  return {
    mod: mods.includes('Mod'),
    alt: mods.includes('Alt'),
    shift: mods.includes('Shift'),
    key,
  }
}

export const parseSequence = (keys: string): Step[] => keys.split(' ').map(parseStep)

/** Whether a step has no Mod or Alt: typing that letter must not trigger it inside a text field. */
export const isBare = (s: Step) => !s.mod && !s.alt

const isLetter = (k: string) => /^[a-z]$/i.test(k)
const isDigit = (k: string) => /^[0-9]$/.test(k)

export function matchStep(s: Step, e: KeyEventLike): boolean {
  if (s.mod !== (e.ctrlKey || e.metaKey)) return false
  if (s.alt !== e.altKey) return false
  if (s.mod || s.alt) {
    if (s.shift !== e.shiftKey) return false
    if (isLetter(s.key)) return e.code === `Key${s.key.toUpperCase()}`
    if (isDigit(s.key)) return e.code === `Digit${s.key}`
    return e.key === s.key
  }
  // Bare keys: a letter must be unshifted (Caps Lock aside); a symbol like "?" may need Shift to type.
  if (isLetter(s.key)) return s.shift === e.shiftKey && e.key.toLowerCase() === s.key.toLowerCase()
  if (s.key.length > 1) return s.shift === e.shiftKey && e.key === s.key // ArrowLeft, Escape, Home
  return e.key === s.key && (!s.shift || e.shiftKey)
}

/** Alternatives for one shortcut ("Mod+S" or "Mod+Enter"), each a sequence of steps. */
export const asList = (keys: string | string[]) => (Array.isArray(keys) ? keys : [keys])

export const isMac = () =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

const NAMES: Record<string, string> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Escape: 'Esc',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  ' ': 'Space',
}

/** The key caps to draw, one list per step: "g e" -> [["g"], ["e"]]; "Mod+S" -> [["Ctrl", "S"]]. */
export function keyCaps(sequence: string, mac = isMac()): string[][] {
  return parseSequence(sequence).map((s) => {
    const caps: string[] = []
    if (s.mod) caps.push(mac ? '⌘' : 'Ctrl')
    if (s.alt) caps.push(mac ? '⌥' : 'Alt')
    if (s.shift) caps.push(mac ? '⇧' : 'Shift')
    caps.push(NAMES[s.key] ?? (isLetter(s.key) && (s.mod || s.alt) ? s.key.toUpperCase() : s.key))
    return caps
  })
}
