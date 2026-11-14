import { Link, useLocation } from 'react-router'
import { Avatar } from '../components/Avatar.tsx'
import { Icon, type IconName } from '../components/Icon.tsx'
import { useMe } from '../auth/useAuth.ts'
import { cn } from '../lib/cn.ts'
import { newEntryPath, useBrowseParams } from '../lib/useBrowseParams.ts'
import { useDrafts } from '../lib/useDrafts.ts'
import { SyncStatus } from '../components/SyncStatus.tsx'
import { TopLink } from '../components/TopLink.tsx'
import { SidebarJournals } from './SidebarJournals.tsx'

function NavItem({
  to,
  icon,
  label,
  active,
  onNavigate,
  newEntry,
  journalId,
  top,
}: {
  to: string
  icon: IconName
  label: string
  active: boolean
  onNavigate?: () => void
  /** A top-level screen: following it resets the history under it (`TopLink`). */
  top?: boolean
  /** Adds a + that starts a new entry, same as the FAB. */
  newEntry?: boolean
  /** The journal being browsed; the + starts the entry there. */
  journalId?: string
}) {
  const ItemLink = top ? TopLink : Link
  return (
    <div className="relative">
      <ItemLink
        to={to}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'state-layer flex h-12 items-center gap-3 rounded-full px-4 text-sm font-medium',
          active ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface-variant',
          newEntry && 'pr-14',
        )}
      >
        <Icon name={icon} filled={active} />
        {label}
      </ItemLink>
      {newEntry && (
        // A sibling of the link, not a child: anchors can't nest.
        <Link
          to={newEntryPath(journalId)}
          onClick={onNavigate}
          aria-label="New entry"
          title="New entry"
          className="state-layer absolute top-1 right-1 grid size-10 place-items-center rounded-full text-on-surface-variant"
        >
          <Icon name="add" />
        </Link>
      )}
    </div>
  )
}

/**
 * The navigation, in Day One's order: Entries, Insights and Search, the journals, then the housekeeping
 * pair pinned to the bottom. One component for the permanent sidebar and the drawer, so the two
 * can't drift apart. `onNavigate` lets the drawer close itself when a link is followed. In the
 * drawer the whole menu scrolls; in the sidebar (`large:`) only the journal list does, so the top
 * and bottom stay put as in a desktop app.
 */
export function NavContent({ onNavigate }: { onNavigate?: () => void }) {
  const { pathname } = useLocation()
  const inSettings = pathname === '/settings' || pathname.startsWith('/settings/')
  const me = useMe().data
  const { journalId } = useBrowseParams()
  const drafts = useDrafts(me?.id).length
  // Entries is the all-journals view; a journal's own entries highlight that journal instead.
  const entries = pathname === '/' || pathname.startsWith('/entry/') || pathname === '/new'

  return (
    <div className="flex h-full flex-col gap-1 overflow-y-auto px-3 py-4 large:overflow-hidden">
      <div className="flex select-none items-center gap-3 px-3 pb-4">
        <img src="/icon.svg" alt="" className="size-10 rounded-md" />
        <span className="text-xl font-medium">Cairn</span>
      </div>

      <NavItem
        to="/"
        icon="book"
        label="Entries"
        active={entries}
        onNavigate={onNavigate}
        top
        newEntry
        journalId={journalId}
      />
      {drafts > 0 && (
        <NavItem
          to="/drafts"
          icon="edit_note"
          label={`Drafts (${drafts})`}
          active={pathname === '/drafts'}
          onNavigate={onNavigate}
        />
      )}
      <NavItem
        to="/insights"
        icon="bar_chart"
        label="Insights"
        active={pathname === '/insights'}
        onNavigate={onNavigate}
        top
      />
      <NavItem
        to="/prompts"
        icon="lightbulb"
        label="Prompts"
        active={pathname.startsWith('/prompts')}
        onNavigate={onNavigate}
        top
      />
      <NavItem
        to="/search"
        icon="search"
        label="Search"
        active={pathname === '/search'}
        onNavigate={onNavigate}
      />

      <SidebarJournals onNavigate={onNavigate} />

      <div className="mt-auto flex flex-col gap-1 border-t border-outline-variant pt-3">
        <SyncStatus onNavigate={onNavigate} />
        <NavItem
          to="/journals"
          icon="auto_stories"
          label="Manage journals"
          active={pathname === '/journals'}
          onNavigate={onNavigate}
        />
        <Link
          to="/settings"
          onClick={onNavigate}
          aria-current={inSettings ? 'page' : undefined}
          className={cn(
            'state-layer flex h-14 items-center gap-3 rounded-full px-4 text-sm font-medium',
            inSettings
              ? 'bg-secondary-container text-on-secondary-container'
              : 'text-on-surface-variant',
          )}
        >
          <Avatar />
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate">{me?.displayName || me?.username}</span>
            <span className="text-xs font-normal">Settings</span>
          </span>
          <Icon name="settings" className="ml-auto" />
        </Link>
      </div>
    </div>
  )
}
