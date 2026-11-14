import { useState } from 'react'
import { useMe } from '../auth/useAuth.ts'
import type { IconName } from '../components/Icon.tsx'
import { ago } from './relativeTime.ts'
import { useServerDown } from './serverStatus.ts'
import { useOutboxState } from './useOutbox.ts'
import { useOfflineSelection, useSyncState } from './useSync.ts'

const STALE_MS = 7 * 24 * 3_600_000

export interface SyncSummary {
  icon: IconName
  text: string
  /** Text colour class. */
  tone: string
  /** Where tapping it goes. */
  to: string
  /** Worth showing outside the nav (offline, saves waiting, needs a look), not just "all synced". */
  attention: boolean
}

/**
 * The one line that says where things stand: needs review, offline, saves waiting, syncing, or when
 * the journals kept on this device last synced. Null when there is nothing to say (this device
 * keeps no journals and nothing is waiting). Offline is a normal state, not an error, so it uses
 * the quiet colour; only a refused save is red, and a copy a week or more old is flagged.
 */
export function useSyncSummary(): SyncSummary | null {
  const me = useMe().data
  // When the screen opened: a week-old copy doesn't need a live clock to be called old.
  const [opened] = useState(() => Date.now())
  const down = useServerDown()
  const { pending, failed, review } = useOutboxState()
  const sync = useSyncState()
  const selection = useOfflineSelection(me?.id ?? '')
  const kept = (selection?.ready.length ?? 0) + (selection?.waiting.length ?? 0) > 0
  const quiet = 'text-on-surface-variant'

  if (failed > 0)
    return {
      icon: 'sync_problem',
      text: failed === 1 ? 'A save needs review' : `${failed} saves need review`,
      tone: 'text-error',
      to: review ?? '/sync',
      attention: true,
    }
  if (down)
    return {
      icon: 'cloud_off',
      text: pending > 0 ? `Offline · ${pending} waiting to sync` : 'Offline',
      tone: quiet,
      to: '/sync',
      attention: true,
    }
  if (pending > 0)
    return {
      icon: 'cloud_upload',
      text: `${pending} waiting to sync`,
      tone: quiet,
      to: '/sync',
      attention: true,
    }
  if (sync.running)
    return { icon: 'cloud_sync', text: 'Syncing…', tone: quiet, to: '/sync', attention: false }
  if (kept) {
    const at = selection?.syncedAt
    const stale = !!at && opened - at > STALE_MS
    return {
      icon: 'cloud_done',
      text: at ? `Synced ${ago(at)}` : 'Waiting to sync',
      tone: stale ? 'text-tertiary' : quiet,
      to: '/sync',
      attention: stale,
    }
  }
  return null
}
