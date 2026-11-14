import { useLocation, useMatch } from 'react-router'

/**
 * Where the user is in the browse area, from the URL alone:
 *   /                        all journals            /entry/:id (and /entry/:id/edit)
 *   /j/:journalId            one journal             /j/:journalId/entry/:id
 *   /new                     a new entry             /j/:journalId/new (the list stays on that journal)
 * `base` is the list's own path, which an entry's link and its back button build on.
 */
/** Where New entry goes: under the journal being browsed, so the list stays there and the entry starts there. */
export function newEntryPath(journalId?: string) {
  return journalId ? `/j/${journalId}/new` : '/new'
}

/** Pages about the app rather than the journal: no bottom bar and no New entry button. */
const QUIET_PATHS = [
  '/settings',
  '/sync',
  '/journals',
  '/tags',
  '/templates',
  '/users',
  '/storage',
  '/storage/server',
  '/trash',
  '/prompts/all',
  '/prompts/suggested',
]

/** The Entries screen's routes (BrowseLayout): the list, an entry, the editor. */
export const isBrowsePath = (pathname: string) =>
  pathname === '/' || /^\/(j|entry|new)(\/|$)/.test(pathname)

export function useBrowseParams() {
  const { pathname } = useLocation()
  const entryAll = useMatch('/entry/:id')
  const entryIn = useMatch('/j/:journalId/entry/:id')
  const editAll = useMatch('/entry/:id/edit')
  const editIn = useMatch('/j/:journalId/entry/:id/edit')
  const journal = useMatch('/j/:journalId')
  const newAll = useMatch('/new')
  const newIn = useMatch('/j/:journalId/new')
  const journalId =
    entryIn?.params.journalId ??
    editIn?.params.journalId ??
    newIn?.params.journalId ??
    journal?.params.journalId
  const entryId =
    entryAll?.params.id ?? entryIn?.params.id ?? editAll?.params.id ?? editIn?.params.id
  // The editor (new or existing) takes the whole screen: no bottom bar or FAB.
  const editing = !!editAll || !!editIn || !!newAll || !!newIn
  const quiet =
    QUIET_PATHS.includes(pathname) ||
    pathname.startsWith('/trash/') ||
    pathname.startsWith('/settings/')
  return { journalId, entryId, editing, quiet, base: journalId ? `/j/${journalId}` : '' }
}
