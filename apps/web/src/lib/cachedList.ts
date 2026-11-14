import { useQuery } from '@tanstack/react-query'
import type { ZodType } from 'zod'
import { useMe } from '../auth/useAuth.ts'
import { api } from './api.ts'

// A list that is read from the server but kept on this device too (localStorage, per user), so it
// still shows without a connection: writing prompts and entry templates. The copy is only the
// starting value (a stale one, refetched at once); nothing writes through it.

const storageKey = (prefix: string, userId: string, name: string | undefined) =>
  `${prefix}${userId}${name ? `:${name}` : ''}`

function readCache<T>(
  prefix: string,
  userId: string | undefined,
  name: string | undefined,
  schema: ZodType<T>,
) {
  if (!userId) return undefined
  try {
    const raw = localStorage.getItem(storageKey(prefix, userId, name))
    const parsed = raw ? schema.safeParse(JSON.parse(raw)) : undefined
    return parsed?.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

function writeCache(
  prefix: string,
  userId: string | undefined,
  name: string | undefined,
  data: unknown,
) {
  if (!userId) return
  try {
    localStorage.setItem(storageKey(prefix, userId, name), JSON.stringify(data))
  } catch {
    // Storage full or blocked: the cache is a convenience.
  }
}

/** A list that starts from the copy on this device (stale, so it refetches at once). */
export function useCachedList<T>(
  prefix: string,
  name: string | undefined,
  queryKey: readonly string[],
  path: string,
  schema: ZodType<T>,
) {
  const userId = useMe().data?.id
  return useQuery({
    queryKey,
    queryFn: async () => {
      const data = await api(path, { schema })
      writeCache(prefix, userId, name, data)
      return data
    },
    initialData: () => readCache(prefix, userId, name, schema),
    initialDataUpdatedAt: 0,
  })
}
