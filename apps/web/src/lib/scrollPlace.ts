import { ignoreScrollEvents } from './scrollChrome.ts'

/**
 * Putting a scroller back where it was. Content that gives a page its height often arrives after
 * the page mounts (a query, a list's pages), so a single `scrollTo` is clamped to the short page
 * and the place is lost. `placeScroll` sets the position, then keeps setting it as the content
 * grows, until it is reached, the user scrolls for themselves, or `GIVE_UP_MS` passes.
 *
 * While it is pending (`pending()`), whatever saves scroll positions must not: the clamped value
 * is not where the user was, and saving it would overwrite the place being restored.
 */

/** What can be scrolled: the window or an element, behind one shape (and a fake one in tests). */
export interface Scroller {
  get(): number
  set(y: number): void
  /** Calls back when the content's size changes; returns the unsubscribe. */
  watchSize(cb: () => void): () => void
  /** Calls back when the user starts scrolling themselves (wheel, touch, keys); returns the unsubscribe. */
  watchUser(cb: () => void): () => void
}

const GIVE_UP_MS = 5000
/** Browsers round scroll positions, so "there" is within a pixel. */
const CLOSE_ENOUGH_PX = 1
const USER_EVENTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const

export interface Placement {
  /** True until the position was reached or the attempt was given up on. */
  pending(): boolean
  cancel(): void
}

export function placeScroll(scroller: Scroller, y: number): Placement {
  let done = false
  const stops: (() => void)[] = []
  const finish = () => {
    if (done) return
    done = true
    stops.forEach((stop) => stop())
    stops.length = 0
  }
  const attempt = () => {
    if (done) return
    ignoreScrollEvents()
    scroller.set(y)
    if (Math.abs(scroller.get() - y) <= CLOSE_ENOUGH_PX) finish()
  }
  attempt()
  if (!done) {
    stops.push(scroller.watchSize(attempt), scroller.watchUser(finish))
    const timer = setTimeout(finish, GIVE_UP_MS)
    stops.push(() => clearTimeout(timer))
  }
  return { pending: () => !done, cancel: finish }
}

function watchUserOn(target: EventTarget, cb: () => void) {
  USER_EVENTS.forEach((e) => target.addEventListener(e, cb, { capture: true, passive: true }))
  return () => USER_EVENTS.forEach((e) => target.removeEventListener(e, cb, true))
}

const observe = (el: Element, cb: () => void) => {
  const ro = new ResizeObserver(cb)
  ro.observe(el)
  return () => ro.disconnect()
}

/** The page itself (a phone, and every page outside the Entries screen). Its height is the body's. */
export const windowScroller = (): Scroller => ({
  get: () => window.scrollY,
  set: (y) => window.scrollTo(0, y),
  watchSize: (cb) => observe(document.body, cb),
  watchUser: (cb) => watchUserOn(window, cb),
})

/** A pane that scrolls itself (the Entries pane from 840px). Its height is its content's. */
export const elementScroller = (el: HTMLElement): Scroller => ({
  get: () => el.scrollTop,
  set: (y) => void (el.scrollTop = y),
  watchSize: (cb) => {
    const stops = [...el.children].map((c) => observe(c, cb))
    return () => stops.forEach((stop) => stop())
  },
  watchUser: (cb) => watchUserOn(el, cb),
})
