import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useMe } from '../auth/useAuth.ts'
import { openNewJournal } from '../lib/newJournal.ts'
import { useGoBack, useTopNavigate } from '../lib/navigation.ts'
import { useJournals } from '../lib/queries.ts'
import { installShortcuts, usePendingChord, useShortcuts } from '../lib/shortcuts.ts'
import { openPalette, openShortcutHelp } from '../lib/shortcutUi.ts'
import { setThemeMode } from '../lib/theme.ts'
import { newEntryPath, useBrowseParams } from '../lib/useBrowseParams.ts'
import { CommandPalette } from './CommandPalette.tsx'
import { ShortcutHelp } from './ShortcutHelp.tsx'

/**
 * Mounted once in AppShell: listens for keys (lib/shortcuts.ts), registers the shortcuts that are
 * the same on every screen (help, palette, search, new entry, going places, Back) and the
 * palette-only commands, and draws the help dialog, the palette and the half-typed chord hint.
 * Shortcuts that belong to one screen are registered by that screen with `useShortcuts`.
 */
export function ShortcutHost() {
  useEffect(() => installShortcuts(), [])
  const navigate = useNavigate()
  const top = useTopNavigate()
  const back = useGoBack()
  const { pathname } = useLocation()
  const { journalId, entryId, editing } = useBrowseParams()
  const me = useMe().data
  const journals = useJournals().data

  const go = (path: string) => {
    if (path !== pathname) void navigate(path)
  }

  useShortcuts([
    { id: 'help', run: () => openShortcutHelp() },
    { id: 'palette', run: openPalette },
    // The editor has its own Esc (leave); a lone Entries screen has nowhere to go.
    { id: 'back', when: () => !editing && (pathname !== '/' || !!entryId), run: back },
    {
      id: 'search',
      run: () => {
        if (pathname === '/search') {
          document.querySelector<HTMLInputElement>('input[aria-label="Search entries"]')?.focus()
        } else void navigate('/search')
      },
    },
    { id: 'entry.new', when: () => !editing, run: () => void navigate(newEntryPath(journalId)) },
    { id: 'go.entries', run: () => top('/') },
    { id: 'go.insights', run: () => top('/insights') },
    { id: 'go.prompts', run: () => top('/prompts') },
    { id: 'go.drafts', run: () => go('/drafts') },
    { id: 'go.journals', run: () => go('/journals') },
    { id: 'go.tags', run: () => go('/tags') },
    { id: 'go.settings', run: () => go('/settings') },
    { id: 'go.sync', run: () => go('/sync') },
    // Palette only: no key of their own.
    { id: 'go.storage', group: 'Go to', label: 'Storage', run: () => go('/storage') },
    { id: 'go.trash', group: 'Go to', label: 'Trash', run: () => go('/trash') },
    { id: 'go.templates', group: 'Go to', label: 'Templates', run: () => go('/templates') },
    { id: 'go.prompts.all', group: 'Go to', label: 'Your prompts', run: () => go('/prompts/all') },
    {
      id: 'go.prompts.suggested',
      group: 'Go to',
      label: 'Browse suggested prompts',
      run: () => go('/prompts/suggested'),
    },
    {
      id: 'go.prompts.admin',
      group: 'Go to',
      label: 'Suggested prompts settings',
      when: () => me?.role === 'admin',
      run: () => go('/settings/prompts'),
    },
    // Settings pages, so a setting is a few keystrokes away.
    ...(
      [
        ['account', 'Account settings'],
        ['appearance', 'Appearance settings'],
        ['location', 'Location & weather settings'],
        ['keyboard', 'Keyboard settings'],
        ['export', 'Export'],
        ['import', 'Import'],
        ['tips', 'Tips & tricks'],
        ['about', 'About Cairn'],
      ] as const
    ).map(([page, label]) => ({
      id: `go.settings.${page}`,
      group: 'Go to',
      label,
      run: () => go(`/settings/${page}`),
    })),
    ...(
      [
        ['backups', 'Backups & alerts'],
        ['places', 'Places & weather'],
        ['uploads', 'Uploads & Trash settings'],
      ] as const
    ).map(([page, label]) => ({
      id: `go.settings.${page}`,
      group: 'Go to',
      label,
      when: () => me?.role === 'admin',
      run: () => go(`/settings/${page}`),
    })),
    {
      id: 'go.users',
      group: 'Go to',
      label: 'Manage users',
      when: () => me?.role === 'admin',
      run: () => go('/users'),
    },
    { id: 'journal.new', group: 'Journals', label: 'New journal', run: openNewJournal },
    {
      id: 'theme.light',
      group: 'Appearance',
      label: 'Use the light theme',
      run: () => setThemeMode('light'),
    },
    {
      id: 'theme.dark',
      group: 'Appearance',
      label: 'Use the dark theme',
      run: () => setThemeMode('dark'),
    },
    {
      id: 'theme.system',
      group: 'Appearance',
      label: 'Use the device theme',
      run: () => setThemeMode('system'),
    },
    // One command per journal.
    ...(journals ?? [])
      .filter((j) => !j.archivedAt)
      .map((j) => ({
        id: `journal.open.${j.id}`,
        group: 'Journals',
        label: `Open journal: ${j.name}`,
        run: () => top(`/j/${j.id}`),
      })),
  ])

  return (
    <>
      <ShortcutHelp />
      <CommandPalette />
      <ChordHint />
    </>
  )
}

/** The keys of a chord already pressed ("g"), so a pause after the first one isn't a mystery. */
function ChordHint() {
  const pending = usePendingChord()
  if (!pending) return null
  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full bg-inverse-surface px-4 py-2 text-sm text-inverse-on-surface shadow-md"
    >
      {pending}
    </div>
  )
}
