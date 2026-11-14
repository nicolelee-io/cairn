import { Link } from 'react-router'
import { useMenuTrigger } from '../lib/contextMenu.ts'
import { useNewEntryMenu } from '../lib/menuActions.ts'
import { cn } from '../lib/cn.ts'
import { newEntryPath, useBrowseParams } from '../lib/useBrowseParams.ts'
import { useScrollChrome } from '../lib/scrollChrome.ts'
import { useBarVisible } from '../lib/useBarVisible.ts'
import { Icon } from './Icon.tsx'

/**
 * The floating New entry button (M3 FAB): extended with its label at rest, shrinking to the icon while scrolling down (`lib/scrollChrome.ts`).
 * It sits above the bottom bar where there is one, stays out of the reader's way (hidden on a phone
 * while an entry is open) and is never shown on the new-entry screen. Holding it (or right-click)
 * raises a pill per journal to start the entry in (`useNewEntryMenu`).
 */
export function NewEntryButton() {
  const { journalId, entryId, editing, quiet } = useBrowseParams()
  const { barHidden, fabShrunk } = useScrollChrome()
  const bar = useBarVisible() && !barHidden
  const trigger = useMenuTrigger(useNewEntryMenu(journalId), 'New entry in', true)
  if (editing || quiet) return null
  return (
    <Link
      to={newEntryPath(journalId)}
      aria-label="New entry"
      {...trigger}
      className={cn(
        'state-layer fixed right-4 transition-[bottom,padding] duration-200 z-30 flex h-14 min-w-14 items-center justify-center rounded-lg bg-primary-container text-on-primary-container shadow-md',
        bar
          ? 'bottom-[calc(5rem+env(safe-area-inset-bottom))]'
          : 'bottom-[calc(1.5rem+env(safe-area-inset-bottom))]',
        fabShrunk ? 'px-4 large:px-5' : 'px-5',
        'expanded:right-6 large:right-6 large:bottom-6',
        entryId && 'hidden expanded:flex',
      )}
    >
      <Icon name="edit" />
      <span
        aria-hidden={fabShrunk ? true : undefined}
        className={cn(
          // The label grows and fades in; the button's width follows it.
          'overflow-hidden text-sm font-medium whitespace-nowrap transition-[max-width,margin,opacity] duration-200 ease-out motion-reduce:transition-none',
          fabShrunk
            ? 'ml-0 max-w-0 opacity-0 large:ml-3 large:max-w-32 large:opacity-100'
            : 'ml-3 max-w-32 opacity-100',
        )}
      >
        New entry
      </span>
    </Link>
  )
}
