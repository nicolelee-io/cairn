import { useState } from 'react'
import { useMe } from '../auth/useAuth.ts'
import { useOutboxSync } from '../lib/useOutbox.ts'
import { Outlet } from 'react-router'
import { ServerBanner } from '../components/ServerBanner.tsx'
import { UpdateBanner } from '../components/UpdateBanner.tsx'
import { ActionDialogs } from '../components/ActionDialogs.tsx'
import { ContextMenu } from '../components/ContextMenu.tsx'
import { BottomBar } from '../components/BottomBar.tsx'
import { NewJournalDialog } from '../components/NewJournalDialog.tsx'
import { Toaster } from '../components/Toaster.tsx'
import { NewEntryButton } from '../components/NewEntryButton.tsx'
import { ShortcutHost } from '../components/ShortcutHost.tsx'
import { cn } from '../lib/cn.ts'
import { useResetScrollChromeOnNavigate } from '../lib/scrollChrome.ts'
import { useWindowScroll } from '../lib/useWindowScroll.ts'
import { useFocusOnNavigate } from '../lib/useFocusOnNavigate.ts'
import '../lib/entryText.ts' // applies the saved font and size as it loads
import { useZenActive } from '../lib/immersive.ts'
import { NavContent } from './NavContent.tsx'
import { NavDrawer } from './NavDrawer.tsx'
import { NavDrawerContext } from './useNavDrawer.ts'

/** Replays saves queued while offline for the signed-in user (lib/outbox.ts). */
function OutboxSync({ userId }: { userId: string }) {
  useOutboxSync(userId)
  return null
}

/**
 * From 1200px the navigation is a permanent sidebar. Below that, Entries and Insights are a bottom
 * bar and the rest is in a drawer opened from the menu button (SPEC 6a). New entry is a FAB at
 * every width; the account avatar lives in the nav's Settings row.
 */
export function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const me = useMe().data
  useResetScrollChromeOnNavigate()
  useFocusOnNavigate()
  useWindowScroll()
  // Zen mode (lib/immersive.ts) takes the sidebar away along with the entry list.
  const immersive = useZenActive()
  return (
    <NavDrawerContext.Provider value={{ open: drawerOpen, setOpen: setDrawerOpen }}>
      <div className={cn('min-h-dvh', !immersive && 'large:pl-72')}>
        {/* The first tab stop, shown only while focused: past the sidebar's links to the page. */}
        <button
          type="button"
          onClick={() => document.getElementById('main')?.focus()}
          className="sr-only z-50 rounded-full bg-primary px-4 py-2 text-on-primary focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        >
          Skip to content
        </button>
        <nav
          aria-label="Main"
          className={cn(
            'fixed inset-y-0 left-0 z-20 hidden w-72 bg-surface',
            !immersive && 'large:block',
          )}
        >
          <NavContent />
        </nav>
        <NavDrawer />
        {me && <OutboxSync userId={me.id} />}
        <ServerBanner />
        <UpdateBanner />
        <Toaster />
        <NewJournalDialog />
        <ContextMenu />
        <ActionDialogs />
        <ShortcutHost />
        <main id="main" tabIndex={-1} className="outline-none">
          <Outlet />
        </main>
        {/* After the page in the DOM, so Tab reaches them last, as they sit at the bottom. */}
        <BottomBar />
        <NewEntryButton />
      </div>
    </NavDrawerContext.Provider>
  )
}
