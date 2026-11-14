import { HealthSchema, type Health } from '@cairn/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api.ts'

/** The build this page was loaded from. */
export const APP_SHA = __APP_SHA__
export const APP_BUILT = __APP_BUILT__
/** The release number (root package.json), e.g. 1.0.0. */
export const APP_VERSION = __APP_VERSION__

const CHECK_EVERY = 10 * 60 * 1000

/** A dev run has no real build to compare. */
export const isDevBuild = (sha: string) => sha === 'dev'

/** True when the server runs a different build than this page: a reload picks up the new one. */
export function updateAvailable(appSha: string, serverSha: string | undefined): boolean {
  if (!serverSha || isDevBuild(appSha) || isDevBuild(serverSha)) return false
  return appSha !== serverSha
}

export const shortSha = (sha: string) => sha.slice(0, 7)

/** '3 Nov 2026, 4:16 PM' in the viewer's zone; a build time is not an entry, so no entry zone. */
export function builtLabel(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : null
  if (!d || Number.isNaN(d.getTime())) return 'unknown'
  return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

const KEY = ['app-version']

/**
 * The server's build, re-read on start, when the tab comes back (an installed PWA resumed from the
 * background keeps running old code) and every ten minutes. A failed read (offline) just keeps the
 * last answer; /api/health is never cached by the service worker.
 */
export function useServerVersion() {
  return useQuery<Health>({
    queryKey: KEY,
    queryFn: () => api('/health', { schema: HealthSchema }),
    refetchInterval: CHECK_EVERY,
    refetchOnWindowFocus: true,
    staleTime: 60 * 1000,
    retry: false,
  })
}

/** Check now (Settings > About): ask the worker to look for a new sw.js too, then re-read health. */
export function useCheckForUpdate() {
  const qc = useQueryClient()
  return async () => {
    await navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => undefined)
    await qc.refetchQueries({ queryKey: KEY })
  }
}

/** Fetches the new shell (navigations are network-first) and starts the new build. */
export const reloadApp = () => window.location.reload()
