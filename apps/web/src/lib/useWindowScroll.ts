import { useLayoutEffect } from 'react'
import { useLocation, useNavigationType } from 'react-router'
import { placeScroll, windowScroller } from './scrollPlace.ts'
import { isBrowsePath } from './useBrowseParams.ts'

// Where each history entry of a window-scrolling page was scrolled to. Not persisted: a reload
// is the browser's own to restore.
const positions = new Map<string, number>()

/**
 * Scroll for every page that scrolls the window (everything outside the Entries screen, whose
 * `BrowseLayout` keeps its own places): a link opens the new page at the top, instead of wherever
 * the last page was scrolled to (Settings, far down, to a short subpage); Back and Forward put the
 * page back where it was, as its content loads (`placeScroll`); a replace (Search retyping the
 * URL) leaves the scroll alone. Call once, in `AppShell`.
 *
 * The listener is attached and removed in layout effects, so it is gone before the next page's own
 * scroll changes can be saved under the wrong history entry.
 */
export function useWindowScroll() {
  const { key, pathname } = useLocation()
  const navigationType = useNavigationType()
  const browse = isBrowsePath(pathname)

  useLayoutEffect(() => {
    if (browse) return
    const saved = positions.get(key)
    const placing = navigationType === 'POP' && saved ? placeScroll(windowScroller(), saved) : null
    if (navigationType === 'PUSH') window.scrollTo(0, 0)
    const save = () => {
      if (!placing?.pending()) positions.set(key, window.scrollY)
    }
    window.addEventListener('scroll', save, { passive: true })
    return () => {
      placing?.cancel()
      window.removeEventListener('scroll', save)
    }
  }, [key, browse, navigationType])
}
