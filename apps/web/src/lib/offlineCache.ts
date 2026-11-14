// The service worker (public/sw.js) keeps recently read entries and photos for offline reading, and
// the local copy (lib/localDb.ts) holds the journals kept offline. Saves still waiting in the outbox stay.
// That data belongs to the signed-in user, so it is deleted whenever the session ends. The prefix
// matches the cache names in sw.js.
import { CACHED_LIST_PREFIXES } from './cachePrefixes.ts'
import { clearLocalCopy, getActiveUser } from './localDb.ts'
import { TAGS_CACHE_PREFIX } from './queries.ts'

const DATA_CACHE_PREFIX = 'cairn-data-'

/** Everything this device kept of the user's data: the worker's caches and the local copy. */
export async function clearOfflineData() {
  const user = getActiveUser()
  if (user) await clearLocalCopy(user).catch(() => undefined)
  try {
    for (const k of Object.keys(localStorage))
      if ([TAGS_CACHE_PREFIX, ...CACHED_LIST_PREFIXES].some((p) => k.startsWith(p)))
        localStorage.removeItem(k)
  } catch {
    // Storage blocked.
  }
  try {
    if (typeof caches === 'undefined') return
    for (const name of await caches.keys())
      if (name.startsWith(DATA_CACHE_PREFIX)) await caches.delete(name)
  } catch {
    // Nothing cached, or storage blocked.
  }
}

/** Must match ASSETS in public/sw.js. */
const ASSETS_CACHE = 'cairn-assets-v1'

/** Cached /assets paths that the current build no longer has (pure, unit-tested). */
export function staleAssetPaths(cached: string[], current: string[]): string[] {
  const keep = new Set(current)
  return cached.filter((p) => p.startsWith('/assets/') && !keep.has(p))
}

/**
 * Every deploy renames the hashed scripts, styles and fonts, and the worker only caps its assets
 * cache by count, so old builds' files pile up. The build writes asset-list.json (vite.config.ts);
 * delete whatever the cache holds that isn't on it. Does nothing if the list can't be read.
 */
export async function pruneStaleAssets() {
  try {
    if (typeof caches === 'undefined') return
    const res = await fetch('/asset-list.json', { cache: 'no-store' })
    if (!res.ok) return
    const list: unknown = await res.json()
    if (!Array.isArray(list) || list.length === 0 || !list.every((p) => typeof p === 'string'))
      return
    const cache = await caches.open(ASSETS_CACHE)
    const requests = await cache.keys()
    const stale = new Set(
      staleAssetPaths(
        requests.map((r) => new URL(r.url).pathname),
        list,
      ),
    )
    for (const r of requests) if (stale.has(new URL(r.url).pathname)) await cache.delete(r)
  } catch {
    // Offline or storage blocked: try again next start.
  }
}

/** Production only: the dev server serves modules the worker would otherwise cache stale. */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Offline reading is a bonus; the app works without it.
    })
    void pruneStaleAssets()
  })
}
