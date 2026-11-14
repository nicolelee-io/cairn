import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { SyncEstimateSchema, type Journal } from '@cairn/shared'
import { api } from './api.ts'
import { keys } from './queries.ts'
import { formatBytes } from './bytes.ts'
import { localDb, requestPersistentStorage } from './localDb.ts'
import { setJournalOffline, setSyncAll, syncNow } from './sync.ts'
import { useOfflineSelection, useSyncState } from './useSync.ts'

/**
 * What the sync screen and the journal dialog share: which journals this device keeps, what each
 * would download, and how to switch one (or all of them) on or off. Per device (lib/sync.ts).
 */
export function useOfflineControls(userId: string) {
  const qc = useQueryClient()
  const selection = useOfflineSelection(userId)
  const sync = useSyncState()
  const estimate = useQuery({
    queryKey: keys.syncEstimate,
    queryFn: () => api('/sync/estimate', { schema: SyncEstimateSchema }),
    staleTime: 60_000,
  })
  const counts = useLocalCounts(userId, sync.version)

  const syncAll = selection?.syncAll ?? false
  /** Kept now, or about to be. */
  const isKept = (j: Journal) =>
    !!(selection?.ready.includes(j.id) || selection?.waiting.includes(j.id))
  /** Kept because "keep everything" is on: its own switch can't turn it off. */
  const isImplied = (j: Journal) => syncAll && !j.archivedAt

  const setJournal = async (j: Journal, on: boolean) => {
    await setJournalOffline(userId, j.id, on)
    if (on) void requestPersistentStorage()
    void syncNow(userId, qc)
  }
  const setAll = async (on: boolean) => {
    await setSyncAll(userId, on)
    if (on) void requestPersistentStorage()
    void syncNow(userId, qc)
  }

  /** The second line under a journal's name. */
  const describe = (j: Journal): string | null => {
    const est = estimate.data?.journals.find((e) => e.journalId === j.id)
    if (selection?.waiting.includes(j.id)) {
      return sync.running
        ? `Downloading… ${sync.downloaded} of ${est?.entries ?? '?'} entries`
        : 'Waiting to download'
    }
    if (selection?.ready.includes(j.id)) {
      const held = `${count(counts[j.id] ?? 0)} on this device`
      return sync.photos ? `${held} · photos ${sync.photos.done} of ${sync.photos.total}` : held
    }
    // The estimate leaves out journals with nothing in them.
    return estimate.data && !est ? 'No entries yet' : sizeOf(est)
  }

  /** What switching on every active journal would download. */
  const allSize = (journals: Journal[]) => {
    const ids = new Set(journals.filter((j) => !j.archivedAt).map((j) => j.id))
    const mine = (estimate.data?.journals ?? []).filter((e) => ids.has(e.journalId))
    return sizeOf(
      mine.reduce(
        (a, e) => ({
          entries: a.entries + e.entries,
          textBytes: a.textBytes + e.textBytes,
          photos: a.photos + e.photos,
          photoBytes: a.photoBytes + e.photoBytes,
        }),
        { entries: 0, textBytes: 0, photos: 0, photoBytes: 0 },
      ),
    )
  }

  /** Photo bytes held for the journals already downloaded (what the server says they weigh). */
  const keptPhotoBytes = (estimate.data?.journals ?? [])
    .filter((e) => selection?.ready.includes(e.journalId))
    .reduce((n, e) => n + e.photoBytes, 0)

  return {
    selection,
    sync,
    syncAll,
    isKept,
    isImplied,
    setJournal,
    setAll,
    describe,
    allSize,
    keptPhotoBytes,
  }
}

const count = (n: number) => `${n} ${n === 1 ? 'entry' : 'entries'}`

interface Size {
  entries: number
  textBytes: number
  photos: number
  photoBytes: number
}
function sizeOf(est: Size | undefined): string | null {
  if (!est) return null
  if (est.entries === 0) return 'No entries yet'
  const parts = [count(est.entries), `text (${formatBytes(est.textBytes)})`]
  if (est.photos) parts.push(`${est.photos} photos (${formatBytes(est.photoBytes)})`)
  return parts.join(' · ')
}

/** Entries held locally per journal, re-counted when a sync changes things. */
function useLocalCounts(userId: string, version: number) {
  const [counts, setCounts] = useState<Record<string, number>>({})
  useEffect(() => {
    let live = true
    void (async () => {
      const db = localDb(userId)
      const next: Record<string, number> = {}
      for (const j of await db.journals.toArray()) {
        next[j.id] = await db.entries.where('journalId').equals(j.id).count()
      }
      if (live) setCounts(next)
    })()
    return () => {
      live = false
    }
  }, [userId, version])
  return counts
}

export interface StorageUse {
  /** Everything this site stores in the browser. */
  total: number
  /** The local database: entries, the outbox. Chromium only. */
  data: number | null
  /** Cache Storage: photos and the app itself. Chromium only. */
  files: number | null
  /** The browser's own ceiling for this site; a share of free disk space, so only worth showing near full. */
  quota: number
}

export function useStorageUse(version: number): StorageUse | null {
  const [s, setS] = useState<StorageUse | null>(null)
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const e = (await navigator.storage.estimate()) as StorageEstimate & {
          usageDetails?: { indexedDB?: number; caches?: number }
        }
        if (live && e.quota)
          setS({
            total: e.usage ?? 0,
            data: e.usageDetails?.indexedDB ?? null,
            files: e.usageDetails?.caches ?? null,
            quota: e.quota,
          })
      } catch {
        // No storage API: say nothing.
      }
    })()
    return () => {
      live = false
    }
  }, [version])
  return s
}
