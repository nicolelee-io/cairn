// Cairn's service worker (Phase 7.3): lets the installed app open and read without the server.
// Plain JS on purpose (served as-is from /sw.js, no build step). It never touches writes: only GETs
// are cached, and a save while offline still fails into the editor's draft flow (7.4 adds the outbox).
//
//  - Navigations: network first, the last good app shell as fallback.
//  - /assets/* (scripts, styles, fonts): cache first (content-hashed, so a name never changes its bytes).
//  - Photo display/thumb: the kept-on-device cache first, else cache first (capped). Originals
//    are never cached.
//  - The avatar picture: cache first (its URL carries a version).
//  - Entries, journals and "me": network first, cache as fallback, marked `x-cairn-offline` so the
//    page can show its "can't reach the server" banner even though it got an answer.
//
// A gateway answer (502/503/504, Cloudflare 52x) counts as offline for navigations and data.
// Cached API data belongs to whoever is signed in: the page deletes the `cairn-data-*` caches on
// logout and on a 401 (lib/offlineCache.ts). Keep the names below in step with that file.

const SHELL = 'cairn-shell-v1'
const ASSETS = 'cairn-assets-v1'
const DATA = 'cairn-data-api-v1'
const PHOTOS = 'cairn-data-photos-v1'
// Photos of journals kept on the device (lib/sync.ts fills it): never trimmed, looked up first.
const KEPT_PHOTOS = 'cairn-data-offline-photos-v1'
// The account's avatar picture (/api/avatar?v=<version>): cache first, so it shows offline.
const AVATAR = 'cairn-data-avatar-v1'
const KEEP = [SHELL, ASSETS, DATA, PHOTOS, KEPT_PHOTOS, AVATAR]

const MAX_ASSETS = 150
const MAX_API = 200
const MAX_PHOTOS = 400
const MAX_AVATAR = 3 // one per version; an old one is dead weight

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) if (!KEEP.includes(name)) await caches.delete(name)
      await self.clients.claim()
    })(),
  )
})

// Oldest first: Cache.keys() is in insertion order, and put() below deletes before re-adding.
async function put(cacheName, request, response, max) {
  const cache = await caches.open(cacheName)
  await cache.delete(request)
  await cache.put(request, response)
  const keys = await cache.keys()
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(k)
}

const isApiData = (p) =>
  p === '/api/auth/me' ||
  p === '/api/journals' ||
  p === '/api/entries' ||
  p.startsWith('/api/entries/')
const isPhoto = (p) => /^\/api\/photos\/[^/]+\/(display|thumb)$/.test(p)

async function photo(request) {
  const kept = await caches.match(request, { cacheName: KEPT_PHOTOS })
  return kept ?? cacheFirst(request, PHOTOS, MAX_PHOTOS)
}

async function cacheFirst(request, cacheName, max) {
  const hit = await caches.match(request, { cacheName })
  if (hit) return hit
  const res = await fetch(request)
  if (res.ok) await put(cacheName, request, res.clone(), max)
  return res
}

// The tunnel or proxy in front of the app answering "the app isn't there" counts as offline.
const gatewayDown = (s) => s === 502 || s === 503 || s === 504 || (s >= 520 && s <= 530)

async function networkFirstData(request) {
  try {
    const res = await fetch(request)
    if (gatewayDown(res.status)) throw new Error('gateway')
    // 2xx only: a 401 or 404 must not replace good data.
    if (res.ok) await put(DATA, request, res.clone(), MAX_API)
    return res
  } catch (e) {
    const hit = await caches.match(request, { cacheName: DATA })
    if (!hit) throw e
    const headers = new Headers(hit.headers)
    headers.set('x-cairn-offline', '1')
    return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers })
  }
}

async function navigation(request) {
  try {
    const res = await fetch(request)
    if (gatewayDown(res.status)) throw new Error('gateway')
    // Every route is the same shell; keep one copy under '/'.
    if (res.ok && res.headers.get('content-type')?.includes('text/html'))
      await put(SHELL, new Request('/'), res.clone(), 1)
    return res
  } catch (e) {
    const hit = await caches.match('/', { cacheName: SHELL })
    if (!hit) throw e
    return hit
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return // map tiles etc. go straight to the network

  const path = url.pathname
  // A file opened in its own tab (a PDF, a photo's original) is the browser's to handle: offline,
  // the app shell at an /api/ address would only be a blank page.
  if (request.mode === 'navigate' && !path.startsWith('/api/'))
    return event.respondWith(navigation(request))
  if (isPhoto(path)) {
    // The sync's own downloads go straight to the network; the page stores them (lib/sync.ts).
    if (request.headers.has('x-cairn-keep')) return
    return event.respondWith(photo(request))
  }
  if (path === '/api/avatar') return event.respondWith(cacheFirst(request, AVATAR, MAX_AVATAR))
  if (isApiData(path)) return event.respondWith(networkFirstData(request))
  if (path.startsWith('/assets/')) return event.respondWith(cacheFirst(request, ASSETS, MAX_ASSETS))
})
