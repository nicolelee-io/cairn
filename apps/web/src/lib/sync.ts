import type { QueryClient } from '@tanstack/react-query'
import { SyncChangesSchema, type SyncChanges } from '@cairn/shared'
import { JournalSchema } from '@cairn/shared'
import { z } from 'zod'
import { api } from './api.ts'
import { keys } from './queries.ts'
import { localDb, type LocalDb } from './localDb.ts'
import { clearOfflineData } from './offlineCache.ts'
import { photoUrl } from './photos.ts'
import { isUnreachable } from './outbox.ts'
import { isGatewayDown } from './serverStatus.ts'

// Keeps the journals the user chose on this device (Phase 7.4c). The server's change feed
// (GET /api/sync/changes, SPEC 7.4a) is pulled into the local database: first a journal's whole
// history, then only what changed after a cursor. The set of journals is a per-device choice kept
// in the `meta` table, so a phone and a laptop can keep different ones.
//
//   meta 'offline'  journal ids already downloaded and kept current
//   meta 'backfill' journal ids switched on but not downloaded yet
//   meta 'syncAll'  keep every journal that isn't archived, including ones created later
//   meta 'cursor'   the feed position everything in 'offline' is current to
//   meta 'syncedAt' when the last pull finished

const PAGE = 200
/** Must match KEPT_PHOTOS in public/sw.js. */
export const KEPT_PHOTOS_CACHE = 'cairn-data-offline-photos-v1'
const PHOTO_KINDS = ['thumb', 'display'] as const
const PHOTO_CONCURRENCY = 4

const getMeta = async <T>(db: LocalDb, key: string, fallback: T): Promise<T> =>
  ((await db.meta.get(key))?.value as T | undefined) ?? fallback
const setMeta = (db: LocalDb, key: string, value: unknown) => db.meta.put({ key, value })

export interface OfflineSelection {
  /** Downloaded and kept current. */
  ready: string[]
  /** Switched on, waiting for (or in the middle of) the first download. */
  waiting: string[]
  syncedAt: number | null
  /** Every non-archived journal is kept, new ones included. */
  syncAll: boolean
}

export async function offlineSelection(userId: string): Promise<OfflineSelection> {
  const db = localDb(userId)
  return {
    ready: await getMeta<string[]>(db, 'offline', []),
    waiting: await getMeta<string[]>(db, 'backfill', []),
    syncedAt: await getMeta<number | null>(db, 'syncedAt', null),
    syncAll: await getMeta<boolean>(db, 'syncAll', false),
  }
}

/** Turns a journal's offline copy on (it downloads on the next sync) or off (its rows go now). */
export async function setJournalOffline(userId: string, journalId: string, on: boolean) {
  const db = localDb(userId)
  await db.transaction('rw', [db.meta, ...db.syncedTables()], async () => {
    const ready = new Set(await getMeta<string[]>(db, 'offline', []))
    const waiting = new Set(await getMeta<string[]>(db, 'backfill', []))
    if (on) {
      if (!ready.has(journalId)) waiting.add(journalId)
    } else {
      ready.delete(journalId)
      waiting.delete(journalId)
      await dropJournalRows(db, [journalId])
      if (ready.size === 0) await db.meta.delete('cursor')
    }
    await setMeta(db, 'offline', [...ready])
    await setMeta(db, 'backfill', [...waiting])
  })
  if (!on) void syncKeptPhotos(userId) // nothing to download; this only drops the files
  notify()
}

/**
 * Forgets everything this device kept of the account: the local copy, the choice of journals to
 * keep, and the worker's cached reads and photos. Saves still waiting in the outbox stay.
 */
export async function forgetOfflineData() {
  await clearOfflineData()
  notify()
}

/**
 * Turns "keep everything" on or off. On, the next sync adds every journal that isn't archived
 * (and each one created later); off, what is already kept stays kept, now one by one.
 */
export async function setSyncAll(userId: string, on: boolean) {
  await setMeta(localDb(userId), 'syncAll', on)
  notify()
}

/** With "keep everything" on: queues any active journal not yet kept. Needs the journal list. */
async function addActiveJournals(db: LocalDb) {
  const journals = await api('/journals', { schema: z.array(JournalSchema) })
  const ready = await getMeta<string[]>(db, 'offline', [])
  const waiting = new Set(await getMeta<string[]>(db, 'backfill', []))
  // rev 0 is a journal made offline and not sent yet (lib/outbox.ts): the server can't send it.
  for (const j of journals)
    if (!j.archivedAt && j.rev !== 0 && !ready.includes(j.id)) waiting.add(j.id)
  await setMeta(db, 'backfill', [...waiting])
}

async function dropJournalRows(db: LocalDb, journalIds: string[]) {
  const ids = await db.entries.where('journalId').anyOf(journalIds).primaryKeys()
  await dropEntryRows(db, ids)
}

/** Entries go with their photos and attachments. */
async function dropEntryRows(db: LocalDb, ids: string[]) {
  await db.photos.where('entryId').anyOf(ids).delete()
  await db.attachments.where('entryId').anyOf(ids).delete()
  await db.entries.bulkDelete(ids)
}

/**
 * Makes the kept-photos cache match the local copy: downloads the thumb and display file of every
 * photo it lacks, and drops files of photos no longer held. The worker looks in this cache first
 * and never trims it. Originals are not kept. Returns false if the server couldn't be reached.
 */
export async function syncKeptPhotos(
  userId: string,
  progress?: (done: number, total: number) => void,
): Promise<boolean> {
  if (typeof caches === 'undefined') return true
  const cache = await caches.open(KEPT_PHOTOS_CACHE)
  const wanted = new Set(
    (await localDb(userId).photos.toCollection().primaryKeys()).flatMap((id) =>
      PHOTO_KINDS.map((k) => photoUrl(id, k)),
    ),
  )
  const have = new Set<string>()
  for (const req of await cache.keys()) {
    const path = new URL(req.url).pathname
    if (wanted.has(path)) have.add(path)
    else await cache.delete(req)
  }
  const missing = [...wanted].filter((u) => !have.has(u))
  let done = 0
  let reachable = true
  progress?.(0, missing.length)
  const queue = [...missing]
  const worker = async () => {
    for (let url = queue.shift(); url && reachable; url = queue.shift()) {
      try {
        const res = await fetch(url, {
          headers: { 'x-cairn-keep': '1' },
          signal: AbortSignal.timeout(60_000),
        })
        if (res.ok) await cache.put(url, res)
        else if (isGatewayDown(res.status)) reachable = false
      } catch {
        reachable = false
      }
      progress?.(++done, missing.length)
    }
  }
  await Promise.all(Array.from({ length: PHOTO_CONCURRENCY }, worker))
  return reachable
}

/** Writes one page of the feed. Deletes first-class: a gone entry takes its media with it. */
async function apply(db: LocalDb, page: SyncChanges) {
  await db.transaction('rw', [...db.syncedTables(), db.meta], async () => {
    await db.journals.bulkPut(page.journals)
    if (page.deletedJournalIds.length) {
      await db.journals.bulkDelete(page.deletedJournalIds)
      await dropJournalRows(db, page.deletedJournalIds)
      for (const key of ['offline', 'backfill']) {
        const ids = await getMeta<string[]>(db, key, [])
        await setMeta(
          db,
          key,
          ids.filter((id) => !page.deletedJournalIds.includes(id)),
        )
      }
    }
    if (page.deletedEntryIds.length) await dropEntryRows(db, page.deletedEntryIds)
    await db.entries.bulkPut(
      page.entries.map((e) => ({
        ...e,
        id: e.entry.id,
        journalId: e.entry.journalId,
        createdAt: e.entry.createdAt,
      })),
    )
    await db.photos.bulkDelete(page.deletedPhotoIds)
    await db.photos.bulkPut(page.photos)
    await db.attachments.bulkDelete(page.deletedAttachmentIds)
    await db.attachments.bulkPut(page.attachments)
  })
}

type Progress = (entriesSoFar: number) => void

/** Follows the feed to its end from `since`; returns the cursor, or null if the server said reset. */
async function pull(
  db: LocalDb,
  since: number,
  journalIds: string[],
  progress: Progress,
): Promise<number | null> {
  let cursor = since
  let seen = 0
  for (;;) {
    const q = new URLSearchParams({
      since: String(cursor),
      limit: String(PAGE),
      journalIds: journalIds.join(','),
    })
    // The timeout keeps a stalled request from holding the cross-tab lock until the tab closes.
    const page = await api(`/sync/changes?${q}`, { schema: SyncChangesSchema, timeoutMs: 30_000 })
    if (page.reset) return null
    await apply(db, page)
    seen += page.entries.length
    progress(seen)
    cursor = page.cursor
    if (!page.hasMore) return cursor
  }
}

// ---- State for the UI ----

export interface SyncState {
  running: boolean
  /** Entries downloaded so far in this run. */
  downloaded: number
  /** Photo files fetched so far, and how many this run needs; null when not downloading photos. */
  photos: { done: number; total: number } | null
  error: 'offline' | 'failed' | null
  /** Bumped whenever the local copy or the selection changes, so views re-read it. */
  version: number
}
let state: SyncState = { running: false, downloaded: 0, photos: null, error: null, version: 0 }
const listeners = new Set<() => void>()
const set = (next: Partial<SyncState>) => {
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}
const notify = () => set({ version: state.version + 1 })
export const syncState = () => state
export function subscribeSync(l: () => void) {
  listeners.add(l)
  return () => void listeners.delete(l)
}

/** Runs `fn` unless another tab is syncing; returns whether it ran. */
async function exclusively(fn: () => Promise<void>): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request('cairn-sync', { ifAvailable: true }, async (lock) => {
      if (!lock) return false
      await fn()
      return true
    })
  }
  await fn()
  return true
}

// Another tab or the installed app finished a sync: its results are in the shared database, so
// re-read the selection (the "Synced <ago>" line) and let the app refetch its lists.
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('cairn-sync')
const syncedElsewhere = new Set<() => void>()
channel?.addEventListener('message', () => {
  notify()
  syncedElsewhere.forEach((f) => f())
})
export function onSyncedElsewhere(f: () => void) {
  syncedElsewhere.add(f)
  return () => void syncedElsewhere.delete(f)
}

let retryTimer: ReturnType<typeof setTimeout> | undefined

let running = false

/**
 * Brings the local copy up to date: what changed since last time for the journals already kept,
 * then the first download of any just switched on. Serialised across tabs; a no-op when nothing is
 * kept offline. Never throws: an unreachable server just leaves the copy as it was.
 */
export async function syncNow(userId: string, qc?: QueryClient): Promise<void> {
  if (running) return
  running = true
  const db = localDb(userId)
  try {
    const ran = await exclusively(async () => {
      if ((await offlineSelection(userId)).syncAll) {
        // Offline, the journal list isn't there to read; keep the journals already held current.
        await addActiveJournals(db).catch(() => undefined)
      }
      let { ready, waiting } = await offlineSelection(userId)
      if (ready.length + waiting.length === 0) return
      set({ running: true, downloaded: 0, photos: null, error: null })
      let base = 0
      const progress: Progress = (n) => set({ downloaded: base + n })

      for (let attempt = 0; attempt < 2; attempt++) {
        let reset = false
        if (ready.length) {
          const cursor = await getMeta<number>(db, 'cursor', 0)
          const next = await pull(db, cursor, ready, progress)
          if (next === null) reset = true
          else await setMeta(db, 'cursor', next)
        }
        // The server's history is behind our cursor (a restored backup): start over from nothing.
        if (reset) {
          await db.transaction('rw', [...db.syncedTables(), db.meta], async () => {
            await Promise.all(db.syncedTables().map((t) => t.clear()))
            await db.meta.delete('cursor')
            await setMeta(db, 'offline', [])
            await setMeta(db, 'backfill', [...new Set([...waiting, ...ready])])
          })
          ;({ ready, waiting } = await offlineSelection(userId))
          continue
        }
        break
      }

      for (const journalId of waiting) {
        base = state.downloaded
        const cursor = await pull(db, 0, [journalId], progress)
        if (cursor === null) continue
        await db.transaction('rw', db.meta, async () => {
          const offline = await getMeta<string[]>(db, 'offline', [])
          const backfill = await getMeta<string[]>(db, 'backfill', [])
          // The first journal fixes the cursor; later ones are covered by the next incremental pull.
          if (offline.length === 0) await setMeta(db, 'cursor', cursor)
          await setMeta(db, 'offline', [...new Set([...offline, journalId])])
          await setMeta(
            db,
            'backfill',
            backfill.filter((id) => id !== journalId),
          )
        })
        notify()
      }
      const photosOk = await syncKeptPhotos(userId, (done, total) =>
        set({ photos: total ? { done, total } : null }),
      )
      if (!photosOk) set({ error: 'offline' })
      await setMeta(db, 'syncedAt', Date.now())
      channel?.postMessage('synced')
    })
    if (!ran) {
      // Someone else holds the lock; look again soon instead of waiting for the next timer.
      clearTimeout(retryTimer)
      retryTimer = setTimeout(() => void syncNow(userId, qc), 15_000)
    }
    void qc?.invalidateQueries({ queryKey: keys.entries })
  } catch (e) {
    set({ error: isUnreachable(e) ? 'offline' : 'failed' })
  } finally {
    running = false
    set({ running: false, photos: null, version: state.version + 1 })
  }
}
