import { useLocation } from 'react-router'
import { useMe } from '../../auth/useAuth.ts'
import { Avatar } from '../../components/Avatar.tsx'
import { Icon, type IconName } from '../../components/Icon.tsx'
import { ListRow } from '../../components/ListRow.tsx'
import { OfflineBanner } from '../../components/NeedsConnection.tsx'
import { plural } from '../../lib/format.ts'
import { useSuggestedPrompts } from '../../lib/prompts.ts'
import { useAdminUsers, useJournals, useTags } from '../../lib/queries.ts'
import { useServerDown } from '../../lib/serverStatus.ts'
import { useTemplates } from '../../lib/templates.ts'
import { useTempUnit } from '../../lib/tempUnit.ts'
import { useThemeMode } from '../../lib/theme.ts'
import { useTrashCount } from '../../lib/trash.ts'
import { useMediaQuery } from '../../lib/useMediaQuery.ts'
import { useOfflineSelection } from '../../lib/useSync.ts'
import { TWO_PANE } from '../../lib/pane.ts'

interface Row {
  to: string
  icon: IconName
  title: string
  line: string
}

/** Every row's path, so a row only claims the pages under it that have no row of their own. */
const isUnder = (pathname: string, to: string, all: string[]) =>
  pathname === to || (pathname.startsWith(`${to}/`) && !all.includes(pathname))

/**
 * Settings' list of pages: the whole screen at `/settings` on a phone, the left pane beside the page
 * from 840px (where a row replaces the page instead of stacking it, like entries beside the list).
 */
export function SettingsNav() {
  const me = useMe().data
  const { pathname } = useLocation()
  const wide = useMediaQuery(TWO_PANE)
  const down = useServerDown()
  const admin = me?.role === 'admin'
  const fine = useMediaQuery('(any-pointer: fine)')

  const theme = useThemeMode()
  const unit = useTempUnit()
  const journals = useJournals().data?.filter((j) => !j.archivedAt).length
  const tags = useTags().data?.tags.length
  const templates = useTemplates().data?.templates.length
  const trash = useTrashCount().data
  const trashed = trash ? trash.entries + trash.journals : 0
  const days = me?.trashRetentionDays ?? 60
  const users = useAdminUsers(admin).data?.users.length
  const prompts = useSuggestedPrompts().data?.prompts.length
  const sel = useOfflineSelection(me?.id ?? '')
  const kept = (sel?.ready.length ?? 0) + (sel?.waiting.length ?? 0)

  const preferences: Row[] = [
    {
      to: '/settings/appearance',
      icon: 'palette',
      title: 'Appearance',
      line: `${theme === 'system' ? 'System' : theme === 'light' ? 'Light' : 'Dark'} theme`,
    },
    {
      to: '/settings/location',
      icon: 'location_on',
      title: 'Location & weather',
      line: `${me?.autoLocation ? 'Location on' : 'Location off'} · °${unit}`,
    },
    // Hidden where the shortcuts can't be typed: a touch screen with no mouse or trackpad.
    ...(fine
      ? [
          {
            to: '/settings/keyboard',
            icon: 'keyboard' as const,
            title: 'Keyboard',
            line: 'Shortcut keys',
          },
        ]
      : []),
    {
      to: '/sync',
      icon: 'cloud_sync',
      title: 'Offline & sync',
      line: sel?.syncAll
        ? 'All journals kept'
        : kept > 0
          ? `${plural(kept, 'journal', 'journals')} kept`
          : 'Not turned on',
    },
  ]
  const data: Row[] = [
    {
      to: '/journals',
      icon: 'auto_stories',
      title: 'Manage journals',
      line: journals ? plural(journals, 'journal', 'journals') : 'Add, rename, archive',
    },
    {
      to: '/tags',
      icon: 'sell',
      title: 'Manage tags',
      line: tags ? plural(tags, 'tag', 'tags') : 'Rename, merge, delete',
    },
    {
      to: '/templates',
      icon: 'description',
      title: 'Manage templates',
      line: templates ? plural(templates, 'template', 'templates') : 'Text to insert',
    },
    {
      to: '/trash',
      icon: 'delete',
      title: 'Trash',
      line: trashed ? `${plural(trashed, 'item', 'items')} · ${days} days` : `Kept ${days} days`,
    },
    {
      to: '/storage',
      icon: 'hard_drive',
      title: 'Storage',
      line: 'Space you use',
    },
    {
      to: '/settings/export',
      icon: 'download',
      title: 'Export',
      line: 'Download as a zip',
    },
    {
      to: '/settings/import',
      icon: 'upload_file',
      title: 'Import',
      line: 'From Day One or Cairn',
    },
  ]
  // Read from the server afresh, so hidden offline (each page also says it needs a connection).
  const server: Row[] =
    admin && !down
      ? [
          {
            to: '/users',
            icon: 'group',
            title: 'Manage users',
            line: users ? plural(users, 'user', 'users') : 'Who can sign in',
          },
          {
            to: '/storage/server',
            icon: 'dns',
            title: 'Server storage',
            line: 'Database, each user',
          },
          {
            to: '/settings/prompts',
            icon: 'lightbulb',
            title: 'Suggested prompts',
            line: prompts ? plural(prompts, 'prompt', 'prompts') : 'For everyone',
          },
          {
            to: '/settings/backups',
            icon: 'backup',
            title: 'Backups & alerts',
            line: 'Backup status, alerts',
          },
          {
            to: '/settings/places',
            icon: 'travel_explore',
            title: 'Places & weather',
            line: 'Google key, weather',
          },
          {
            to: '/settings/uploads',
            icon: 'tune',
            title: 'Uploads & Trash',
            line: 'Photos, files, Trash',
          },
        ]
      : []
  const help: Row[] = [
    {
      to: '/settings/tips',
      icon: 'help',
      title: 'Tips & tricks',
      line: 'Gestures, menus, shortcuts',
    },
    {
      to: '/settings/about',
      icon: 'info',
      title: 'About',
      line: 'Version, updates',
    },
  ]
  const all = [...preferences, ...data, ...server, ...help].map((r) => r.to)
  // From 840px `/settings` shows Account in the pane, so its row is the current one there too.
  const accountCurrent = pathname === '/settings/account' || (wide && pathname === '/settings')

  const row = (r: Row) => {
    const current = isUnder(pathname, r.to, all)
    return (
      <ListRow
        key={r.to}
        as="link"
        to={r.to}
        replace={wide}
        current={current}
        className={
          current && wide ? 'bg-secondary-container text-on-secondary-container' : undefined
        }
        targetClassName="min-h-16 rounded-none py-2"
        lead={<Icon name={r.icon} className="text-on-surface-variant" />}
        title={r.title}
        lines={[r.line]}
        end={<Icon name="chevron_right" className="text-on-surface-variant expanded:hidden" />}
      />
    )
  }
  const group = (rows: Row[], heading?: string) =>
    rows.length > 0 && (
      <section aria-label={heading} className="flex flex-col gap-1">
        {heading && <h2 className="px-4 pt-2 text-sm font-medium text-primary">{heading}</h2>}
        <ul className="overflow-hidden rounded-lg bg-surface-container-low">{rows.map(row)}</ul>
      </section>
    )

  return (
    <div className="flex flex-col gap-3">
      {down && (
        <OfflineBanner title="You’re offline">
          Some settings need a connection. Others save now and sync later.
        </OfflineBanner>
      )}
      <ul className="overflow-hidden rounded-lg bg-surface-container-low">
        <ListRow
          as="link"
          to="/settings/account"
          replace={wide}
          current={accountCurrent}
          label="Account"
          className={
            accountCurrent && wide
              ? 'bg-secondary-container text-on-secondary-container'
              : undefined
          }
          targetClassName="min-h-20 rounded-none py-3"
          lead={<Avatar className="size-12 text-lg" />}
          title={<span className="text-lg">{me?.displayName || me?.username}</span>}
          lines={['Profile, password, timezone']}
          end={<Icon name="chevron_right" className="text-on-surface-variant expanded:hidden" />}
        />
      </ul>
      {group(preferences, 'Preferences')}
      {group(data, 'Your data')}
      {group(server, 'Server')}
      {group(help)}
    </div>
  )
}
