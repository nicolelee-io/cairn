import { useLayoutEffect } from 'react'
import { useLocation, useNavigate, type Location } from 'react-router'

/*
 * Back works like an app's, not a website's. The tab's history is kept shaped as a stack:
 *
 *   Entries (/)  ->  one top-level screen  ->  drill-downs...
 *
 * - Top-level screens (Entries, a journal, Insights) reset the stack: `useTopNavigate` steps back to
 *   Entries at the bottom and pushes the new screen there, so switching journals never piles up.
 * - Everything else (an entry, the editor, Search, Settings and its subpages, Drafts) is a plain
 *   push, so Back returns to wherever it was opened from.
 * - Opening another entry beside the one already open replaces it (`replace={!!entryId}`).
 * - The on-screen Back (`useGoBack`) does exactly what the browser's or Android's Back does, and
 *   only falls back to the screen's parent when there is nothing behind it.
 *
 * Depth is React Router's own history index (`history.state.idx`, 0 for the first entry the app
 * made in this tab). A fresh load at a deep link (a bookmark, a shared link) gets its parents
 * filled in underneath (`NavigationSync`), so index 0 is always Entries and Back never leaves the
 * app before reaching it.
 */

const routerIndex = () =>
  typeof window === 'undefined' ? undefined : (window.history.state as { idx?: number } | null)?.idx

/** React Router's index of the current history entry; 0 is the bottom of the app's stack. */
export const historyDepth = () => routerIndex() ?? 0

/** Whether Back stays in the app. */
export const canGoBack = () => historyDepth() > 0

// Read before the router writes its state: no index yet means this load started a new stack.
const freshLoad = routerIndex() == null
let synthesized = false

const SETTINGS_PAGES = ['/journals', '/tags', '/templates', '/users', '/storage', '/sync', '/trash']

/** The screens above this one, nearest last: where Back goes, and what a deep link fills in. */
export function ancestorsOf(pathname: string): string[] {
  if (pathname === '/') return []
  if (pathname === '/storage/server') return ['/', '/settings', '/storage']
  if (SETTINGS_PAGES.includes(pathname)) return ['/', '/settings']
  if (pathname === '/prompts/all' || pathname === '/prompts/suggested') return ['/', '/prompts']
  if (/^\/trash\/[^/]+$/.test(pathname)) return ['/', '/settings', '/trash']
  if (pathname === '/settings/appearance/entry-text')
    return ['/', '/settings', '/settings/appearance']
  if (/^\/settings\/[^/]+$/.test(pathname)) return ['/', '/settings']
  const journal = /^\/j\/([^/]+)/.exec(pathname)
  const base = journal ? `/j/${journal[1]}` : ''
  const chain = journal && pathname !== base ? ['/', base] : ['/']
  const reader = /^((?:\/j\/[^/]+)?\/entry\/[^/]+)\/edit$/.exec(pathname)?.[1]
  if (reader) chain.push(reader)
  return chain
}

export const parentOf = (pathname: string) => ancestorsOf(pathname).at(-1) ?? '/'

// A top-level switch steps back first; where to go once Entries is reached. Kept in
// sessionStorage because stepping back past a reload loads the app again.
const PENDING = 'cairn-nav-pending'
const PENDING_MS = 10_000

function setPending(to: string) {
  sessionStorage.setItem(PENDING, JSON.stringify({ to, at: Date.now() }))
}

function takePending(): string | null {
  const raw = sessionStorage.getItem(PENDING)
  if (!raw) return null
  sessionStorage.removeItem(PENDING)
  try {
    const { to, at } = JSON.parse(raw) as { to: string; at: number }
    return Date.now() - at < PENDING_MS ? to : null
  } catch {
    return null
  }
}

const here = (l: Location) => l.pathname + l.search

/** Goes to a top-level screen (Entries, a journal, Insights) with the stack reset under it. */
export function useTopNavigate() {
  const navigate = useNavigate()
  const location = useLocation()
  return (to: string) => {
    if (to === here(location)) return
    const depth = historyDepth()
    if (depth === 0) {
      if (to === '/') void navigate(to, { replace: true })
      else void navigate(to)
      return
    }
    setPending(to)
    void navigate(-depth)
  }
}

/** The on-screen Back: the same step as the browser's Back, or up to the parent at the bottom. */
export function useGoBack() {
  const navigate = useNavigate()
  const location = useLocation()
  return () => {
    if (canGoBack()) void navigate(-1)
    else void navigate(parentOf(location.pathname), { replace: true })
  }
}

/**
 * Keeps the history shaped as a stack: fills in a deep link's parents on a fresh load, and
 * finishes a top-level switch once the step back has landed on Entries. Rendered once, inside
 * the router. A layout effect, so the screen in between isn't painted.
 */
export function NavigationSync() {
  const navigate = useNavigate()
  const location = useLocation()

  useLayoutEffect(() => {
    if (freshLoad && !synthesized) {
      synthesized = true
      const chain = ancestorsOf(location.pathname)
      if (chain.length === 0) return
      const target = location.pathname + location.search + location.hash
      void navigate('/', { replace: true })
      for (const p of chain.slice(1)) void navigate(p)
      void navigate(target, { state: location.state })
      return
    }
    if (historyDepth() !== 0) return
    const to = takePending()
    if (to === null) return
    if (here(location) !== '/') void navigate('/', { replace: true })
    if (to !== '/') void navigate(to)
  }, [location, navigate])

  return null
}
