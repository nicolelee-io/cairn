import { useEffect, useRef, useSyncExternalStore } from 'react'
import { CATALOG, type CatalogId, type Meta } from './shortcutCatalog.ts'
import { asList, isBare, matchStep, parseSequence, type Step } from './shortcutKeys.ts'

/*
 * The keyboard shortcut registry. Screens register what they can do with `useShortcuts`; one
 * listener (`installShortcuts`, mounted once by `ShortcutHost` in AppShell) matches key presses
 * against what is registered right now. The help dialog and the command palette read the same
 * list, so the three can't drift apart. A shortcut with no `keys` is a palette command only.
 *
 * Rules the listener enforces:
 *  - A bare key (no Ctrl/Cmd/Alt) never fires while a text field has focus. The quick actions can
 *    be switched off per device (`setBareKeys`, on by default) and the `g` chords switched on
 *    (`setGoToKeys`, off by default).
 *  - Nothing fires behind an open dialog, unless the shortcut says `inDialog`.
 *  - When two shortcuts share keys the more specific scope wins (the reader's j/k, older and newer
 *    entry, beat the list's j/k) and `when` decides what is live.
 *  - A chord ("g e") waits for its next key for `CHORD_MS`.
 *  - It listens in the capture phase, so it runs before CodeMirror's own keymap (Mod+I would
 *    otherwise select the parent syntax node).
 */

export type Scope = 'global' | 'browse' | 'reader' | 'editor'
const PRIORITY: Record<Scope, number> = { global: 0, browse: 1, reader: 2, editor: 3 }

/** A shortcut as registered: what it is (lib/shortcutCatalog.ts) plus what it does. */
export interface Shortcut extends Meta {
  /** Unique and stable, e.g. "go.entries". */
  id: string
  /** Whether the shortcut applies right now (the screen it belongs to is showing, ...). */
  when?: () => boolean
  run: () => void
}

/** What a screen passes: a catalogued shortcut's id with its behaviour, or a whole palette command. */
export type Spec = { id: CatalogId; when?: () => boolean; run: () => void } | Shortcut

const full = (s: Spec): Shortcut =>
  ({ ...(CATALOG as Record<string, Meta>)[s.id], ...s }) as Shortcut

const registry = new Map<string, Shortcut>()
const listeners = new Set<() => void>()
let snapshot: Shortcut[] = []

function changed() {
  snapshot = [...registry.values()]
  listeners.forEach((l) => l())
}

function register(list: Shortcut[]): () => void {
  for (const s of list) registry.set(s.id, s)
  changed()
  return () => {
    for (const s of list) if (registry.get(s.id) === s) registry.delete(s.id)
    changed()
  }
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}

/** Every registered shortcut, for the help dialog and the palette. */
export const useShortcutList = () =>
  useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  )

/**
 * Registers shortcuts for as long as the component is mounted. `run` and `when` may close over
 * anything: the latest ones are called. The set re-registers only when an id, label or key changes.
 */
export function useShortcuts(specs: Spec[]) {
  const latest = useRef(specs)
  useEffect(() => {
    latest.current = specs
  })
  const signature = specs
    .map(full)
    .map((s) =>
      [s.id, s.group, s.label, s.scope, asList(s.keys ?? []).join('/'), s.palette].join('|'),
    )
    .join('\n')
  useEffect(() => {
    const wrapped = latest.current.map((s) => ({
      ...full(s),
      when: () => latest.current.find((x) => x.id === s.id)?.when?.() ?? true,
      run: () => latest.current.find((x) => x.id === s.id)?.run(),
    }))
    return register(wrapped)
    // The signature stands for everything that is registered by value.
  }, [signature])
}

/** Whether a catalogued shortcut is registered by a screen that is showing and applies now. */
export const isActive = (id: string): boolean => {
  const s = registry.get(id)
  return !!s && isLive(s)
}

// ---- The per-device switches ----
// Two families of bare keys: the quick actions (n, e, j, k, ...), on unless switched off, and the
// `g` chords that go places, off unless switched on. Both are in Settings > Keyboard.

/** The `g` chords are the "Go to" group; everything else bare is a quick action. */
export const isGoTo = (s: Pick<Meta, 'group'>) => s.group === 'Go to'

/** A key that is a single press with no Ctrl, Cmd or Alt: what the quick-action switch controls. */
const isQuickKey = (keys: string | string[]) =>
  asList(keys).every((k) => isBare(parseSequence(k)[0]!))

/** Whether a shortcut's keys are switched on, given the two Settings switches. */
export const keysUsable = (s: Pick<Meta, 'group' | 'keys'>, quick: boolean, goTo: boolean) =>
  isGoTo(s) ? goTo : quick || !s.keys || !isQuickKey(s.keys)

function deviceSwitch(key: string, fallback: boolean) {
  let on = (() => {
    try {
      const v = localStorage.getItem(key)
      return v === null ? fallback : v === 'on'
    } catch {
      return fallback
    }
  })()
  const subs = new Set<() => void>()
  return {
    get: () => on,
    set: (next: boolean) => {
      on = next
      try {
        localStorage.setItem(key, next ? 'on' : 'off')
      } catch {
        // Not persisted (private window): still applies for this session.
      }
      subs.forEach((l) => l())
    },
    use: () =>
      useSyncExternalStore(
        (l) => {
          subs.add(l)
          return () => void subs.delete(l)
        },
        () => on,
      ),
  }
}

const quick = deviceSwitch('cairn:bare-shortcuts', true)
const goTo = deviceSwitch('cairn:goto-shortcuts', false)
export const setBareKeys = quick.set
export const useBareKeys = quick.use
export const setGoToKeys = goTo.set
export const useGoToKeys = goTo.use

// ---- The key press that has started a chord, for the little hint on screen ----

let pendingText: string | null = null
const pendingListeners = new Set<() => void>()
const setPendingText = (t: string | null) => {
  pendingText = t
  pendingListeners.forEach((l) => l())
}

/** What to show while a chord waits for its next key ("Go to…"), else null. */
export const usePendingChord = () =>
  useSyncExternalStore(
    (l) => {
      pendingListeners.add(l)
      return () => void pendingListeners.delete(l)
    },
    () => pendingText,
  )

// ---- The listener ----

const CHORD_MS = 1500
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock'])
const NON_TEXT_INPUTS = new Set([
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'file',
  'image',
  'color',
  'range',
])

type Context = 'page' | 'editor' | 'field'

/** Where the key press landed: the entry editor, some other text field, or nowhere that types. */
function contextOf(target: EventTarget | null): Context {
  if (!(target instanceof HTMLElement)) return 'page'
  if (target.closest('.cm-editor')) return 'editor'
  // A control that uses the keys itself (the mood picker's arrows) counts as a text field.
  if (target.closest('[data-owns-keys]')) return 'field'
  if (target instanceof HTMLInputElement) return NON_TEXT_INPUTS.has(target.type) ? 'page' : 'field'
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return 'field'
  // A focused player uses the arrow keys itself (seeking).
  return target.isContentEditable || target instanceof HTMLMediaElement ? 'field' : 'page'
}

interface Candidate {
  shortcut: Shortcut
  seq: Step[]
}

/** Whether the shortcut applies right now; a `when` that throws counts as no. */
export function isLive(s: Shortcut): boolean {
  try {
    return s.when?.() ?? true
  } catch {
    return false
  }
}

function candidates(): Candidate[] {
  const out: Candidate[] = []
  for (const shortcut of registry.values()) {
    if (!shortcut.keys) continue
    if (!isLive(shortcut)) continue
    for (const k of asList(shortcut.keys)) out.push({ shortcut, seq: parseSequence(k) })
  }
  return out
}

/** May this shortcut start from a key pressed in this context? */
function startAllowed(c: Candidate, ctx: Context, dialogOpen: boolean): boolean {
  if (dialogOpen && !c.shortcut.inDialog) return false
  const first = c.seq[0]
  if (!first) return false
  if (isBare(first)) {
    if (!(isGoTo(c.shortcut) ? goTo.get() : quick.get())) return false
    return ctx === 'page' || (ctx === 'editor' && !!c.shortcut.inCodeEditor)
  }
  // With Ctrl/Cmd/Alt held, typing is not what the key press means; the editor's own are fine in
  // the editor, and a shortcut for the editor has no business inside some other field.
  return !(ctx === 'field' && c.shortcut.scope === 'editor')
}

const priorityOf = (c: Candidate) => PRIORITY[c.shortcut.scope ?? 'global']

export function installShortcuts(): () => void {
  // A chord in progress: who is still in the running, and the keys pressed so far.
  let alive: Candidate[] = []
  let pressed: string[] = []
  let timer: ReturnType<typeof setTimeout> | undefined

  const clear = () => {
    alive = []
    pressed = []
    clearTimeout(timer)
    setPendingText(null)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.isComposing || MODIFIER_KEYS.has(e.key)) return
    const consume = () => {
      e.preventDefault()
      e.stopPropagation()
    }
    if (pressed.length > 0 && e.key === 'Escape') {
      clear()
      consume()
      return
    }

    let step = pressed.length
    let pool: Candidate[] = []
    if (step > 0) {
      pool = alive.filter((c) => matchStep(c.seq[step]!, e))
      // Not what the chord was waiting for: forget it and read this key as a fresh start.
      if (pool.length === 0) {
        clear()
        step = 0
      }
    }
    if (step === 0) {
      const ctx = contextOf(e.target)
      const dialogOpen = document.querySelector('dialog[open]') !== null
      pool = candidates().filter((c) => matchStep(c.seq[0]!, e) && startAllowed(c, ctx, dialogOpen))
    }
    if (pool.length === 0) return

    const done = pool.filter((c) => c.seq.length === step + 1)
    if (done.length > 0) {
      done.sort((a, b) => priorityOf(b) - priorityOf(a))
      clear()
      consume()
      done[0]!.shortcut.run()
      return
    }
    // The start (or middle) of a chord: wait for the next key.
    alive = pool.filter((c) => c.seq.length > step + 1)
    pressed = [...pressed, e.key]
    // "Go to…" when the chord leads into one group, else the keys so far.
    const groups = new Set(alive.map((c) => c.shortcut.group))
    const [only] = groups
    setPendingText(`${groups.size === 1 && only ? only : pressed.join(' ')}…`)
    consume()
    clearTimeout(timer)
    timer = setTimeout(clear, CHORD_MS)
  }

  window.addEventListener('keydown', onKeyDown, true)
  return () => {
    window.removeEventListener('keydown', onKeyDown, true)
    clear()
  }
}
