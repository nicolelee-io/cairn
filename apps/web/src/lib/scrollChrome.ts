import { useEffect, useSyncExternalStore } from 'react'
import { useLocation } from 'react-router'

/** How far a scroller must move in one direction before the chrome reacts. */
const THRESHOLD = 12

type State = { barHidden: boolean; fabShrunk: boolean }
let state: State = { barHidden: false, fabShrunk: false }
const listeners = new Set<() => void>()
const lastTop = new WeakMap<EventTarget, number>()
let travelled = 0
let quietUntil = 0

function set(next: State) {
  if (next.barHidden === state.barHidden && next.fabShrunk === state.fabShrunk) return
  state = next
  listeners.forEach((l) => l())
}

function onScroll(e: Event) {
  const t = e.target
  const top = t instanceof Element ? t.scrollTop : window.scrollY
  const prev = lastTop.get(t ?? document) ?? top
  lastTop.set(t ?? document, top)
  const delta = top - prev
  if (delta === 0) return
  // The page moved itself, not the reader: that may bring the chrome back (a view with nothing to
  // scroll up would otherwise leave it hidden for good) but never hides it.
  if (delta > 0 && performance.now() < quietUntil) return
  if (top <= 0) {
    travelled = 0
    set({ barHidden: false, fabShrunk: false })
    return
  }
  // Restart the count when the direction flips.
  travelled = Math.sign(travelled) === Math.sign(delta) ? travelled + delta : delta
  if (travelled > THRESHOLD) set({ barHidden: true, fabShrunk: true })
  else if (travelled < -THRESHOLD) set({ barHidden: false, fabShrunk: false })
}

function subscribe(l: () => void) {
  if (listeners.size === 0)
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
  listeners.add(l)
  return () => {
    listeners.delete(l)
    if (listeners.size === 0) document.removeEventListener('scroll', onScroll, true)
  }
}

/**
 * Scroll-driven chrome: the bottom bar hides while scrolling down and returns on scroll up; the New
 * entry button is full width at rest and on scroll up, and shrinks to its icon while scrolling down. Any scroller counts
 * (the window on a phone, a pane from 840px); a new route starts fresh.
 */
export function useScrollChrome(): State {
  return useSyncExternalStore(subscribe, () => state)
}

/** Call once (AppShell): a route change shows the bar and the full button again. */
export function useResetScrollChromeOnNavigate() {
  const { pathname } = useLocation()
  useEffect(() => {
    travelled = 0
    set({ barHidden: false, fabShrunk: false })
  }, [pathname])
}

/**
 * The page is about to scroll itself (a view's saved place put back, the calendar opening on this
 * month): those scroll events are not the reader's, so the bar and button keep their state through
 * going down (going up still shows them). Scroll events arrive a frame after the scroll, so give them a moment.
 */
export function ignoreScrollEvents(ms = 150) {
  quietUntil = Math.max(quietUntil, performance.now() + ms)
}
