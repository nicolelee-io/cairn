import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { MeSchema, type LoginRequest, type Me, type UpdateMe } from '@cairn/shared'
import { api, ApiError } from '../lib/api.ts'
import { getActiveUser } from '../lib/localDb.ts'
import { clearOfflineData } from '../lib/offlineCache.ts'
import { readPendingMe, sendOrQueueWrite, withPendingMe } from '../lib/outbox.ts'
import { keys } from '../lib/queries.ts'
import { isServerDown } from '../lib/serverStatus.ts'
import { withTempUnit } from '../lib/tempUnit.ts'

/** null means "not signed in"; undefined (while loading) is distinct from it. */
export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: async (): Promise<Me | null> => {
      try {
        const user = getActiveUser()
        const pending = user ? await readPendingMe(user) : undefined // before the request
        return withTempUnit(
          await withPendingMe(await api('/auth/me', { schema: MeSchema }), pending),
        )
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null
        throw e
      }
    },
    staleTime: Infinity,
    retry: false,
  })
}

/**
 * Re-reads the account in the background, so settings changed on another device (temperature unit,
 * default journal, timezone, ...) arrive without a reload; `useMe` itself never goes stale. A failed
 * read keeps what is shown (invalidating instead would put AuthGate's error screen up offline).
 */
export async function refreshMe(qc: QueryClient) {
  try {
    const id = qc.getQueryData<Me | null>(keys.me)?.id
    const pending = id ? await readPendingMe(id) : undefined // before the request: see readPendingMe
    const me = await api('/auth/me', { schema: MeSchema, timeoutMs: 30_000 })
    // The service worker's cached copy (it reports the server down) can predate a change made here.
    if (!isServerDown()) qc.setQueryData(keys.me, withTempUnit(await withPendingMe(me, pending)))
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) qc.setQueryData(keys.me, null)
  }
}

export function useLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: LoginRequest) =>
      api('/auth/login', { method: 'POST', body, schema: MeSchema }),
    onSuccess: (me) => qc.setQueryData(keys.me, withTempUnit(me)),
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    // Only once the server has ended the session (or says there was none): wiping this device while
    // the cookie still works would look signed out and sign straight back in on the next load.
    mutationFn: async () => {
      try {
        await api('/auth/logout', { method: 'POST' })
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 401)) throw e
      }
    },
    onSuccess: () => {
      // Flip `me` first so mounted components see it, then drop everything else cached for the
      // old user. (qc.clear() would orphan the queries those components are watching.)
      void clearOfflineData()
      qc.setQueryData(keys.me, null)
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== keys.me[0] })
    },
  })
}

/**
 * Saves account settings. Offline the change waits in the outbox (`kind: 'me'`) and the cache
 * takes the new values at once; `useMe` keeps laying them over what it reads until they are sent.
 */
export function useUpdateMe() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: UpdateMe): Promise<Me> => {
      const cur = qc.getQueryData<Me | null>(keys.me)
      if (!cur) return api('/auth/me', { method: 'PATCH', body, schema: MeSchema })
      const sent = await sendOrQueueWrite(cur.id, {
        kind: 'me',
        method: 'PATCH',
        path: '/auth/me',
        body,
      })
      return sent.queued ? ({ ...cur, ...body } as Me) : (sent.data as Me)
    },
    onSuccess: (me) => qc.setQueryData(keys.me, withTempUnit(me)),
  })
}
