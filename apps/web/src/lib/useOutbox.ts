import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useSyncExternalStore } from 'react'
import { refreshMe } from '../auth/useAuth.ts'
import { keys } from './queries.ts'
import { requestPersistentStorage, setActiveUser } from './localDb.ts'
import {
  dismissOutboxFailures,
  flushOutbox,
  outboxState,
  refreshOutbox,
  subscribeOutbox,
} from './outbox.ts'
import { onSyncedElsewhere, syncNow } from './sync.ts'

let flushNow: (() => void) | null = null
/** "Retry" in the server banner: try the waiting saves now. */
export const retryOutbox = () => flushNow?.()

export const useOutboxState = () => useSyncExternalStore(subscribeOutbox, outboxState)

/**
 * Mount once while signed in. Replays waiting saves at start, when the browser says it is back
 * online, when the tab returns to the foreground, and every 20s while something is waiting (the
 * server can be down while the network is up, which fires no event). Each pass is followed by a
 * pull of the journals kept offline (lib/sync.ts), which also runs every 5 minutes.
 */
export function useOutboxSync(userId: string) {
  const qc = useQueryClient()
  useEffect(() => {
    setActiveUser(userId)
    dismissOutboxFailures()
    void refreshOutbox(userId)
    void requestPersistentStorage()
    // Our own waiting saves go first, so the pull after them already includes them.
    const run = () => void flushOutbox(userId, qc).then(() => syncNow(userId, qc))
    flushNow = run
    run()
    // Account settings aren't in the sync feed; re-read them at the same moments as a pull (not at
    // start: useMe has just read them).
    const resume = () => {
      run()
      void refreshMe(qc)
    }
    const timer = setInterval(() => outboxState().pending > 0 && run(), 20_000)
    const pullTimer = setInterval(() => {
      void syncNow(userId, qc)
      void refreshMe(qc)
    }, 5 * 60_000)
    const onVisible = () => document.visibilityState === 'visible' && resume()
    const offSynced = onSyncedElsewhere(() => void qc.invalidateQueries({ queryKey: keys.entries }))
    window.addEventListener('online', resume)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      clearInterval(pullTimer)
      offSynced()
      window.removeEventListener('online', resume)
      document.removeEventListener('visibilitychange', onVisible)
      flushNow = null
      setActiveUser(null)
    }
  }, [userId, qc])
}
