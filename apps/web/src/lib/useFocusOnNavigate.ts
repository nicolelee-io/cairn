import { useEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router'

/**
 * After a route change, if focus was lost (the link that was pressed has gone, so it fell to the
 * page), put it on `main#main` so the next Tab starts from the new page's content instead of the
 * top of the document. Focus that is still on a live element (a search box that survives the
 * change, a card in a list that stays beside the reader) is left alone, and so is Back/Forward,
 * where the browser's own handling is closer to what the user expects. Only the path counts: a
 * query-only change (typing in Search) is not a navigation.
 */
export function useFocusOnNavigate() {
  const { pathname } = useLocation()
  const navigationType = useNavigationType()
  const previous = useRef(pathname)

  useEffect(() => {
    if (previous.current === pathname) return
    previous.current = pathname
    if (navigationType === 'POP') return
    const active = document.activeElement
    if (active && active !== document.body && active.isConnected) return
    document.getElementById('main')?.focus({ preventScroll: true })
  }, [pathname, navigationType])
}
