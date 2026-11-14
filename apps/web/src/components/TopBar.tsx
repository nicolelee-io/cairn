import type { MouseEvent } from 'react'
import type { Journal } from '@cairn/shared'
import { Link } from 'react-router'
import { cn } from '../lib/cn.ts'
import { useGoBack } from '../lib/navigation.ts'
import { useInSettingsPane } from '../lib/pane.ts'
import { Icon, type IconName } from './Icon.tsx'
import { JournalBadge } from './JournalBadge.tsx'
import { MenuButton } from './MenuButton.tsx'
import { SyncIndicator } from './SyncStatus.tsx'

/** Scrolls whatever scrolls the screen the bar is in (a pane from 840px, else the window) to the top. */
function scrollToTop(e: MouseEvent<HTMLElement>) {
  let el = e.currentTarget.parentElement
  while (el && !/auto|scroll/.test(getComputedStyle(el).overflowY)) el = el.parentElement
  const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
  ;(el ?? window).scrollTo({ top: 0, behavior })
}

/**
 * The header every screen starts with: menu, title, search. It stays put while the screen scrolls, and tapping the title scrolls back to the top.
 * `bleed` cancels the screen's side padding so the sticky bar's background spans the full width.
 */
export function TopBar({
  title,
  icon,
  back,
  keepBack,
  bleed,
  journal,
}: {
  title: string
  icon?: IconName
  /** A Back arrow in place of the menu button (Settings subpages); an installed iPhone app has no browser back. */
  back?: boolean
  /** Keep the Back arrow beside Settings' list too (a settings page under another one). */
  keepBack?: boolean
  bleed: string
  /** The journal being browsed: its badge (emoji or book on its colour) leads the title. */
  journal?: Pick<Journal, 'color' | 'icon'> | null
}) {
  const goBack = useGoBack()
  // In Settings' detail pane the list beside it (from 840px) has the menu, search and sync dot.
  const paned = useInSettingsPane()
  return (
    <header className={cn('sticky top-0 z-20 flex h-14 items-center gap-1 bg-background', bleed)}>
      {back || paned ? (
        <button
          type="button"
          onClick={goBack}
          aria-label="Back"
          className={cn(
            'state-layer -ml-2 grid size-10 shrink-0 place-items-center rounded-full text-on-surface-variant',
            paned && !keepBack && 'expanded:hidden',
          )}
        >
          <Icon name="arrow_back" />
        </button>
      ) : (
        <MenuButton className="-ml-2" />
      )}
      {icon && <Icon name={icon} className="ml-1 shrink-0 text-on-surface-variant" />}
      {/* A click target for mouse and touch, not a button: Home and the scroll keys cover the keyboard. */}
      <h1
        onClick={scrollToTop}
        className={cn(
          'flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-2xl',
          icon && 'ml-1',
        )}
      >
        {journal && <JournalBadge journal={journal} size="md" />}
        <span className="min-w-0 truncate">{title}</span>
      </h1>
      <span className={cn('contents', paned && 'expanded:hidden')}>
        <SyncIndicator />
      </span>
      {/* The sidebar has Search; below that width this is the way in. */}
      <Link
        to="/search"
        aria-label="Search"
        className={cn(
          'state-layer grid size-10 shrink-0 place-items-center rounded-full text-on-surface-variant large:hidden',
          paned && 'expanded:hidden',
        )}
      >
        <Icon name="search" />
      </Link>
    </header>
  )
}
