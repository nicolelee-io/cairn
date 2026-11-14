import { reloadApp, updateAvailable, useServerVersion, APP_SHA } from '../lib/appVersion.ts'
import { Button } from './ui/button.tsx'

/**
 * Shown when the server runs a newer build than this page (a phone PWA left open never reloads on
 * its own). It only offers: reloading is the user's call, so an editor is never pulled away
 * (drafts are in localStorage regardless). In the page flow, like ServerBanner.
 */
export function UpdateBanner() {
  const { data } = useServerVersion()
  if (!updateAvailable(APP_SHA, data?.sha)) return null
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-3 bg-secondary-container px-4 py-2 text-sm text-on-secondary-container"
    >
      <span>A new version of Cairn is available.</span>
      <Button variant="text" size="sm" onClick={reloadApp}>
        Reload
      </Button>
    </div>
  )
}
