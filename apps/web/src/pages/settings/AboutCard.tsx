import { useState } from 'react'
import { Button } from '../../components/ui/button.tsx'
import {
  APP_BUILT,
  APP_SHA,
  APP_VERSION,
  builtLabel,
  isDevBuild,
  reloadApp,
  shortSha,
  updateAvailable,
  useCheckForUpdate,
  useServerVersion,
} from '../../lib/appVersion.ts'

/**
 * Where this build's source code is. The AGPL asks anyone who runs a modified Cairn for other people
 * to offer them its source, so a fork points this at its own repository.
 */
const SOURCE_URL = 'https://github.com/nicolelee-io/cairn'

const build = (sha: string, built: string | null | undefined) =>
  isDevBuild(sha) ? 'Development build' : `${shortSha(sha)} · built ${builtLabel(built)}`

/** Which build this device runs and which the server runs, with a manual check for a newer one. */
export function AboutCard() {
  const server = useServerVersion()
  const check = useCheckForUpdate()
  const [checking, setChecking] = useState(false)
  const newer = updateAvailable(APP_SHA, server.data?.sha)
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-surface-container-low p-4">
      <div>
        <p className="text-lg">App on this device</p>
        <p className="text-sm text-on-surface-variant">Cairn {APP_VERSION}</p>
        <p className="text-sm text-on-surface-variant">{build(APP_SHA, APP_BUILT)}</p>
      </div>
      <div>
        <p className="text-lg">Server</p>
        <p className="text-sm text-on-surface-variant">
          {server.data
            ? build(server.data.sha, server.data.builtAt)
            : server.isError
              ? "Can't reach the server."
              : 'Checking…'}
        </p>
      </div>
      <p className="text-sm" role="status">
        {newer ? 'A newer version is available.' : server.data ? 'Up to date.' : ''}
      </p>
      <div className="flex flex-wrap gap-2">
        {newer && <Button onClick={reloadApp}>Reload to update</Button>}
        <Button
          variant="outlined"
          disabled={checking}
          onClick={() => {
            setChecking(true)
            void check().finally(() => setChecking(false))
          }}
        >
          {checking ? 'Checking…' : 'Check for updates'}
        </Button>
      </div>
      <p className="text-sm text-on-surface-variant">
        Cairn is free software under the{' '}
        <a
          href="https://www.gnu.org/licenses/agpl-3.0.html"
          target="_blank"
          rel="noreferrer"
          className="text-primary underline"
        >
          GNU AGPL 3.0
        </a>
        .{' '}
        <a href={SOURCE_URL} target="_blank" rel="noreferrer" className="text-primary underline">
          Source code
        </a>
      </p>
      <p className="text-sm text-on-surface-variant">
        Weather data by{' '}
        <a
          href="https://open-meteo.com/"
          target="_blank"
          rel="noreferrer"
          className="text-primary underline"
        >
          Open-Meteo.com
        </a>{' '}
        (CC BY 4.0).
      </p>
    </div>
  )
}
