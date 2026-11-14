import { useInfiniteQuery, useQuery, type QueryClient } from '@tanstack/react-query'
import {
  BackupStatusSchema,
  GoogleKeyStatusSchema,
  JournalSchema,
  type Journal,
  TagListSchema,
  InsightsStatsSchema,
  InsightsMonthSchema,
  InsightsDetailsSchema,
  InsightsFirstMonthSchema,
  InsightsMonthsSchema,
  InsightsDaySchema,
  OnThisDaySchema,
  type InsightsRange,
  AdminPhotosSchema,
  AdminStorageSchema,
  AdminUserListSchema,
  AttachmentLimitSchema,
  CleanupReportSchema,
  ImportStatusSchema,
  StorageUsageSchema,
  MediaPageSchema,
  type MediaKind,
} from '@cairn/shared'
import { z } from 'zod'
import { api } from './api.ts'
import { getActiveUser } from './localDb.ts'
import { withRememberedTags } from './tags.ts'
import { isServerDown } from './serverStatus.ts'

/**
 * Every query key, so an invalidation can't miss by a typo. Keys nest: invalidating
 * `keys.entries` also refreshes the timelines, the map and recent places, which live under it.
 */
export const keys = {
  me: ['me'] as const,
  journals: ['journals'] as const,
  entry: (id: string) => ['entry', id] as const,
  entries: ['entries'] as const,
  timeline: (journalId: string | undefined, tag?: string) =>
    ['entries', journalId ?? 'all', tag ?? null] as const,
  map: (journalId: string | undefined) => ['entries', 'map', journalId ?? 'all'] as const,
  media: (journalId: string | undefined, kinds: string) =>
    ['entries', 'media', journalId ?? 'all', kinds] as const,
  recentPlaces: ['entries', 'recent-places'] as const,
  tags: ['tags'] as const,
  /** Entry templates (lib/templates.ts). */
  templates: ['templates'] as const,
  /** Writing prompts (lib/prompts.ts); every prompt write refreshes all of them. */
  prompts: ['prompts'] as const,
  promptCategories: ['prompts', 'categories'] as const,
  promptsMine: ['prompts', 'mine'] as const,
  promptsSuggested: ['prompts', 'suggested'] as const,
  insights: ['insights'] as const,
  search: ['search'] as const,
  searchResults: (params: Record<string, unknown>) => ['search', params] as const,
  searchMatches: (entryId: string, q: string) => ['search-matches', entryId, q] as const,
  placesSearch: (q: string, bias: string) => ['places', 'search', q, bias] as const,
  weatherPreview: (lat: number | undefined, lng: number | undefined, bucket: number) =>
    ['weather-preview', lat, lng, bucket] as const,
  googleKey: ['google-key'] as const,
  attachmentLimit: ['attachment-limit'] as const,
  backupStatus: ['backup-status'] as const,
  adminUsers: ['admin-users'] as const,
  storage: ['storage'] as const,
  adminStorage: ['admin-storage'] as const,
  cleanupPreview: ['cleanup-preview'] as const,
  /** The trash page's lists and count (lib/trash.ts); any delete or restore refreshes them. */
  trash: ['trash'] as const,
  trashEntries: ['trash', 'entries'] as const,
  trashJournals: ['trash', 'journals'] as const,
  trashEntry: (id: string) => ['trash', 'entry', id] as const,
  trashCount: ['trash', 'count'] as const,
  adminTrash: ['admin-trash'] as const,
  adminNotifications: ['admin-notifications'] as const,
  adminHealth: ['admin-health'] as const,
  adminPhotos: ['admin-photos'] as const,
  adminWeather: ['admin-weather'] as const,
  syncEstimate: ['sync-estimate'] as const,
  importStatus: ['import-status'] as const,
}

/** After an entry was saved on the server: its lists, search results and the journal counts. */
export function invalidateAfterSave(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: keys.entries })
  void qc.invalidateQueries({ queryKey: keys.search })
  void qc.invalidateQueries({ queryKey: keys.journals })
  void qc.invalidateQueries({ queryKey: keys.tags })
  void qc.invalidateQueries({ queryKey: keys.trash })
  // The calendar's days and Insights read the entries too (a delete from a calendar day's menu).
  void qc.invalidateQueries({ queryKey: keys.insights })
}

/**
 * After tags were renamed, merged or deleted on the server: every entry that carried one changed,
 * so open entries and lists are re-read as well.
 */
export function invalidateAfterTagChange(qc: QueryClient) {
  invalidateAfterSave(qc)
  void qc.invalidateQueries({ queryKey: ['entry'] })
}

/** All of the user's journals, archived ones included (told apart by `archivedAt`). */
export function useJournals() {
  return useQuery({
    queryKey: keys.journals,
    queryFn: () => api('/journals', { schema: z.array(JournalSchema) }),
  })
}

/** The journal with this id in a loaded list (undefined while loading, or for one that is gone). */
export const journalById = (journals: Journal[] | undefined, id: string | null | undefined) =>
  id ? journals?.find((j) => j.id === id) : undefined

/** One journal from the journal list, by id. */
export function useJournal(id: string | null | undefined) {
  return journalById(useJournals().data, id)
}

/** Where the last tag list is kept on this device (per user, in localStorage). */
export const TAGS_CACHE_PREFIX = 'cairn:tags-cache:'

function readTagsCache(userId: string | null) {
  if (!userId) return undefined
  try {
    const raw = localStorage.getItem(TAGS_CACHE_PREFIX + userId)
    const parsed = raw ? TagListSchema.safeParse(JSON.parse(raw)) : undefined
    return parsed?.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

/**
 * The user's tags with how many entries carry each, most used first. Starts from the last list
 * read (stale, so it refetches at once), so the editor can still suggest tags offline when no
 * journal is kept on the device to count them from (lib/localRead.ts).
 */
export function useTags() {
  const userId = getActiveUser()
  return useQuery({
    queryKey: keys.tags,
    queryFn: async () => {
      const data = await api('/tags', { schema: TagListSchema })
      // Offline the list was counted from the kept journals only: keep what was remembered
      // (and don't remember the partial list over the full one).
      if (isServerDown()) {
        return { tags: withRememberedTags(data.tags, readTagsCache(userId)?.tags) }
      }
      if (userId) {
        try {
          localStorage.setItem(TAGS_CACHE_PREFIX + userId, JSON.stringify(data))
        } catch {
          // Storage full or blocked: the cache is a convenience.
        }
      }
      return data
    },
    initialData: () => readTagsCache(userId),
    initialDataUpdatedAt: 0,
  })
}

/** Whether a Google key is set and where it came from (never the key). */
export function useGoogleKey() {
  return useQuery({
    queryKey: keys.googleKey,
    queryFn: () => api('/places/key', { schema: GoogleKeyStatusSchema }),
  })
}

/** The largest attachment upload, instance-wide (Settings). */
export function useAttachmentLimit() {
  return useQuery({
    queryKey: keys.attachmentLimit,
    queryFn: () => api('/attachments/limit', { schema: AttachmentLimitSchema }),
  })
}

/** What the backup sidecar last reported. Re-read when Settings is opened; it changes at most nightly. */
export function useBackupStatus() {
  return useQuery({
    queryKey: keys.backupStatus,
    queryFn: () => api('/backup/status', { schema: BackupStatusSchema }),
    staleTime: 60_000,
  })
}

/** Manage users (admins only): every account, never anything about their journals. */
export function useAdminUsers(enabled = true) {
  return useQuery({
    queryKey: keys.adminUsers,
    queryFn: () => api('/admin/users', { schema: AdminUserListSchema }),
    enabled,
  })
}

/** What the caller's journals and files take on the server (measured on disk each time). */
export function useStorage() {
  return useQuery({
    queryKey: keys.storage,
    queryFn: () => api('/storage', { schema: StorageUsageSchema }),
  })
}

/** Sizes per user and for the server (admins only): numbers, never journal names. */
export function useAdminStorage(enabled = true) {
  return useQuery({
    queryKey: keys.adminStorage,
    queryFn: () => api('/admin/storage', { schema: AdminStorageSchema }),
    enabled,
  })
}

/** Photo quality and the compress-existing job (admins only); polls while the job runs. */
export function useAdminPhotos() {
  return useQuery({
    queryKey: keys.adminPhotos,
    queryFn: () => api('/admin/photos', { schema: AdminPhotosSchema }),
    refetchInterval: (q) => (q.state.data?.job.state === 'running' ? 1500 : false),
  })
}

/** The account's waiting upload and latest import run (Settings > Import); polls while one runs. */
export function useImportStatus() {
  return useQuery({
    queryKey: keys.importStatus,
    queryFn: () => api('/import', { schema: ImportStatusSchema }),
    refetchInterval: (q) => (q.state.data?.job?.state === 'running' ? 1500 : false),
  })
}

/** What the media cleanup would do right now (admins only; a dry run, counts only). */
export function useCleanupPreview(enabled = true) {
  return useQuery({
    queryKey: keys.cleanupPreview,
    queryFn: () => api('/admin/cleanup', { schema: CleanupReportSchema }),
    enabled,
  })
}

// Insights are worked out by the server and not kept offline; each query is for one day, so a
// stale answer is at worst a day old.
export function useInsightsStats(today: string, range: InsightsRange) {
  return useQuery({
    queryKey: [...keys.insights, 'stats', today, range],
    queryFn: () =>
      api(`/insights/stats?today=${today}&range=${range}`, { schema: InsightsStatsSchema }),
    retry: false,
  })
}

const journalQs = (journalId?: string) => (journalId ? `&journalId=${journalId}` : '')

/** `journalId` narrows to one journal (the Entries calendar); Insights covers them all. */
export function useInsightsMonth(month: string, journalId?: string, enabled = true) {
  return useQuery({
    enabled,
    queryKey: [...keys.insights, 'month', month, journalId ?? null],
    queryFn: () =>
      api(`/insights/month?month=${month}${journalQs(journalId)}`, { schema: InsightsMonthSchema }),
    retry: false,
  })
}

/** The Entries Details view's numbers, for one journal or (no id) all of them. */
export function useInsightsDetails(today: string, journalId?: string) {
  return useQuery({
    queryKey: [...keys.entries, 'details', today, journalId ?? null],
    queryFn: () =>
      api(`/insights/details?today=${today}${journalQs(journalId)}`, {
        schema: InsightsDetailsSchema,
      }),
    retry: false,
  })
}

/** Where the Entries calendar stops: the month of the oldest entry. */
export function useInsightsFirstMonth(journalId?: string) {
  return useQuery({
    queryKey: [...keys.insights, 'first-month', journalId ?? null],
    queryFn: () =>
      api(`/insights/first-month?${journalQs(journalId).slice(1)}`, {
        schema: InsightsFirstMonthSchema,
      }),
    retry: false,
  })
}

/** The months with entries, fetched once `enabled` (the month picker opening). */
export function useInsightsMonths(journalId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: [...keys.insights, 'months', journalId ?? null],
    queryFn: () =>
      api(`/insights/months?${journalQs(journalId).slice(1)}`, { schema: InsightsMonthsSchema }),
    enabled,
    retry: false,
  })
}

export function useOnThisDay(date: string) {
  return useQuery({
    queryKey: [...keys.insights, 'on-this-day', date],
    queryFn: () => api(`/insights/on-this-day?date=${date}`, { schema: OnThisDaySchema }),
    retry: false,
  })
}

export function useInsightsDay(date: string | null, journalId?: string) {
  return useQuery({
    queryKey: [...keys.insights, 'day', date, journalId ?? null],
    queryFn: () =>
      api(`/insights/day?date=${date}${journalQs(journalId)}`, { schema: InsightsDaySchema }),
    enabled: date !== null,
    retry: false,
  })
}

const MEDIA_PAGE = 40

/** The Media view's feed, newest entry first. `kinds` narrows it; empty means everything. Needs the server. */
export function useMedia(journalId: string | undefined, kinds: MediaKind[]) {
  const kindsKey = kinds.join(',')
  return useInfiniteQuery({
    queryKey: keys.media(journalId, kindsKey),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ limit: String(MEDIA_PAGE) })
      if (journalId) qs.set('journalId', journalId)
      if (kindsKey) qs.set('kinds', kindsKey)
      if (pageParam) qs.set('cursor', pageParam)
      return api(`/media?${qs}`, { schema: MediaPageSchema })
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
  })
}

/**
 * Re-reads the account (the default journal and counts can change). Not while the server is
 * down: an errored `me` query would put AuthGate's error screen up, and the offline reads
 * answer from the cache anyway.
 */
export function invalidateMe(qc: QueryClient) {
  if (!isServerDown()) void qc.invalidateQueries({ queryKey: keys.me })
}
