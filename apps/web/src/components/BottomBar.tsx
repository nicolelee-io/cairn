import { useLocation } from 'react-router'
import { cn } from '../lib/cn.ts'
import { useScrollChrome } from '../lib/scrollChrome.ts'
import { useBarVisible } from '../lib/useBarVisible.ts'
import { Icon, type IconName } from './Icon.tsx'
import { TopLink } from './TopLink.tsx'

const ITEMS: { to: string; label: string; icon: IconName; match: (p: string) => boolean }[] = [
  {
    to: '/',
    label: 'Entries',
    icon: 'book',
    match: (p) => p === '/' || p.startsWith('/j/') || p.startsWith('/entry/') || p === '/new',
  },
  { to: '/insights', label: 'Insights', icon: 'bar_chart', match: (p) => p === '/insights' },
  { to: '/prompts', label: 'Prompts', icon: 'lightbulb', match: (p) => p === '/prompts' },
]

/**
 * The common destinations, as a bottom bar wherever the sidebar isn't (under 1200px). Everything
 * else (journals, Manage journals, Settings) is in the menu. On a phone it steps aside while an
 * entry is open, like a full-screen reader should.
 */
export function BottomBar() {
  const { pathname } = useLocation()
  const { barHidden } = useScrollChrome()
  if (!useBarVisible()) return null

  return (
    <nav
      aria-label="Primary"
      className={cn(
        // 4rem of bar plus the safe area under it (the FAB and toast sit at 5rem + the same inset). A
        // plain h-16 would let the padding eat into the bar and squash it whenever the browser hides
        // its address bar and the inset becomes non-zero.
        'fixed inset-x-0 bottom-0 z-20 flex h-[calc(4rem+env(safe-area-inset-bottom))] bg-surface-container pb-[env(safe-area-inset-bottom)] transition-transform duration-200',
        barHidden && 'translate-y-full',
      )}
    >
      {ITEMS.map((item) => {
        const active = item.match(pathname)
        return (
          <TopLink
            key={item.to}
            to={item.to}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-1 text-xs font-medium',
              active ? 'text-on-surface' : 'text-on-surface-variant',
            )}
          >
            <span
              className={cn(
                'state-layer grid h-8 w-16 place-items-center rounded-full transition-colors',
                active && 'bg-secondary-container text-on-secondary-container',
              )}
            >
              <Icon name={item.icon} filled={active} />
            </span>
            {item.label}
          </TopLink>
        )
      })}
    </nav>
  )
}
