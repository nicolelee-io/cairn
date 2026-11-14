import { Link } from 'react-router'
import { useSyncSummary } from '../lib/useSyncSummary.ts'
import { Icon } from './Icon.tsx'

/** The sync line in the nav (the permanent sidebar, or the drawer). */
export function SyncStatus({ onNavigate }: { onNavigate?: () => void }) {
  const s = useSyncSummary() ?? {
    icon: 'cloud_off' as const,
    text: 'Sync not turned on',
    tone: 'text-on-surface-variant',
    to: '/sync',
  }
  return (
    <Link
      to={s.to}
      onClick={onNavigate}
      className={`state-layer flex items-center gap-3 rounded-full px-4 py-2 text-sm ${s.tone}`}
    >
      <Icon name={s.icon} className="size-5" />
      <span className="min-w-0 truncate">{s.text}</span>
    </Link>
  )
}

/**
 * The same status as one icon in a screen's top bar, for widths where the nav is a drawer. Only
 * there when something needs attention, so an ordinary session has nothing extra in the header.
 */
export function SyncIndicator() {
  const s = useSyncSummary()
  if (!s?.attention) return null
  return (
    <Link
      to={s.to}
      aria-label={s.text}
      title={s.text}
      className={`state-layer grid size-10 shrink-0 place-items-center rounded-full large:hidden ${s.tone}`}
    >
      <Icon name={s.icon} />
    </Link>
  )
}
