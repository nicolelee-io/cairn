import { Outlet, useLocation } from 'react-router'
import { TopBar } from '../components/TopBar.tsx'
import { InSettingsPane, TWO_PANE } from '../lib/pane.ts'
import { useMediaQuery } from '../lib/useMediaQuery.ts'
import { Page } from '../pages/Page.tsx'
import { SettingsNav } from '../pages/settings/SettingsNav.tsx'

/**
 * Settings and its subpages (its own `/settings/...` pages and the ones with their own URLs, like
 * `/journals` and `/trash`). Same URLs at every width; only what is visible changes:
 *   under 840px  `/settings` is the list; a subpage is the whole screen, with Back
 *   840px and up the list on the left, the page beside it, each scrolling on its own;
 *                `/settings` shows Account there
 */
export function SettingsLayout() {
  const { pathname } = useLocation()
  const wide = useMediaQuery(TWO_PANE)
  const page = (
    <InSettingsPane.Provider value={true}>
      <Outlet />
    </InSettingsPane.Provider>
  )
  if (!wide)
    return pathname === '/settings' ? (
      <Page title="Settings" icon="settings">
        <SettingsNav />
      </Page>
    ) : (
      page
    )
  return (
    <div className="flex h-dvh">
      {/* Not a `Page`: a narrow column wants less side padding than a page's. */}
      <section
        aria-label="Settings"
        className="w-[clamp(20rem,30vw,24rem)] shrink-0 overflow-y-auto border-x border-outline-variant"
      >
        {/* The column is inside the scroller, or a fixed-height flex column shrinks the top bar. */}
        <div className="flex flex-col gap-4 px-4 pb-24">
          <TopBar title="Settings" icon="settings" bleed="-mx-4 px-4" />
          <SettingsNav />
        </div>
      </section>
      {/* Keyed by the page so each one opens at the top of the pane. */}
      <div key={pathname} className="min-w-0 flex-1 overflow-y-auto">
        {page}
      </div>
    </div>
  )
}
