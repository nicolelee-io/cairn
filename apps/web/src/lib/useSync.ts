import { useEffect, useState, useSyncExternalStore } from 'react'
import { offlineSelection, subscribeSync, syncState, type OfflineSelection } from './sync.ts'

export const useSyncState = () => useSyncExternalStore(subscribeSync, syncState)

/** Which journals this device keeps; re-read whenever a sync or a switch changes it. */
export function useOfflineSelection(userId: string): OfflineSelection | null {
  const { version } = useSyncState()
  const [sel, setSel] = useState<OfflineSelection | null>(null)
  useEffect(() => {
    if (!userId) return
    let live = true
    void offlineSelection(userId).then((s) => live && setSel(s))
    return () => {
      live = false
    }
  }, [userId, version])
  return sel
}
