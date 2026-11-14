import { useMe } from '../auth/useAuth.ts'
import { OfflineJournalRow } from '../components/OfflineJournalRow.tsx'
import { Button } from '../components/ui/button.tsx'
import { ConfirmDialog } from '../components/ui/dialog.tsx'
import { Switch } from '../components/ui/switch.tsx'
import { formatBytes } from '../lib/bytes.ts'
import { useJournals } from '../lib/queries.ts'
import { ago } from '../lib/relativeTime.ts'
import { forgetOfflineData } from '../lib/sync.ts'
import { retryOutbox } from '../lib/useOutbox.ts'
import { useOfflineControls, useStorageUse, type StorageUse } from '../lib/useOfflineControls.ts'
import { Page } from './Page.tsx'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

/**
 * Offline & sync: which journals this device keeps a copy of (Phase 7.4), and how much room that
 * takes. Per device, so it is kept in the local database rather than on the account.
 */
export function SyncPage() {
  const me = useMe().data
  return (
    <Page title="Offline & sync" icon="cloud_sync" back>
      {me && <SyncBody userId={me.id} />}
    </Page>
  )
}

function SyncBody({ userId }: { userId: string }) {
  const qc = useQueryClient()
  // A journal made offline (rev 0) can be kept once it has reached the server.
  const journals = (useJournals().data ?? []).filter((j) => j.rev !== 0)
  const c = useOfflineControls(userId)
  const storage = useStorageUse(c.sync.version)
  const active = journals.filter((j) => !j.archivedAt)
  const archived = journals.filter((j) => j.archivedAt)
  const keepsAny = c.syncAll || journals.some((j) => c.isKept(j))

  return (
    <>
      <p className="text-sm text-on-surface-variant">
        Journals kept on this device work without a connection and catch up when you’re back
        online. Photos are saved at a reduced size.
      </p>

      <div className="flex items-center gap-4 rounded-lg bg-surface-container-low p-4">
        <div className="min-w-0 flex-1">
          <p className="text-lg">Keep all journals</p>
          <p className="text-sm text-on-surface-variant">
            Includes journals you create later. Archived journals are not included.
            {c.allSize(journals) && ` Now: ${c.allSize(journals)}.`}
          </p>
        </div>
        <Switch checked={c.syncAll} label="Keep all journals on this device" onChange={c.setAll} />
      </div>

      <div className="flex flex-col gap-1 rounded-lg bg-surface-container-low p-4">
        <p className="text-lg">Journals</p>
        {active.length === 0 ? (
          <p className="text-sm text-on-surface-variant">No journals yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {active.map((j) => (
              <OfflineJournalRow key={j.id} journal={j} c={c} />
            ))}
          </ul>
        )}
        {archived.length > 0 && (
          <details className="mt-2 border-t border-outline-variant pt-2">
            <summary className="cursor-pointer py-2 text-sm text-on-surface-variant">
              Archived journals ({archived.length})
            </summary>
            <ul className="flex flex-col gap-1">
              {archived.map((j) => (
                <OfflineJournalRow key={j.id} journal={j} c={c} />
              ))}
            </ul>
          </details>
        )}
      </div>

      {keepsAny && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-container-low p-4">
          <p className="text-sm text-on-surface-variant">
            {c.sync.error === 'offline'
              ? 'Can’t reach the server. It will try again.'
              : c.sync.error === 'failed'
                ? 'The last sync failed. It will try again.'
                : c.selection?.syncedAt
                  ? `Last synced ${ago(c.selection.syncedAt)}.`
                  : 'Not synced yet.'}
          </p>
          <Button
            variant="tonal"
            disabled={c.sync.running}
            onClick={() => {
              retryOutbox() // waiting saves first, then the pull
              void qc.refetchQueries({ type: 'active' })
            }}
          >
            {c.sync.running ? 'Syncing…' : 'Sync now'}
          </Button>
        </div>
      )}

      {storage && <StorageGauge use={storage} photoBytes={c.keptPhotoBytes} />}
      <ForgetCard busy={c.sync.running} />
    </>
  )
}

/** Unsyncs everything and deletes what this device holds of the account (it stays on the server). */
function ForgetCard({ busy }: { busy: boolean }) {
  const [confirming, setConfirming] = useState(false)
  const [forgetting, setForgetting] = useState(false)
  const forget = async () => {
    setForgetting(true)
    await forgetOfflineData()
    setForgetting(false)
    setConfirming(false)
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-container-low p-4">
      <div className="min-w-0 flex-1">
        <p className="text-lg">Clear data on this device</p>
        <p className="text-sm text-on-surface-variant">
          Removes the offline copies from this device. Your account isn’t affected.
        </p>
      </div>
      <Button
        variant="tonal"
        disabled={busy}
        className="hover:bg-error hover:text-on-error"
        onClick={() => setConfirming(true)}
      >
        Clear data
      </Button>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Clear data on this device?"
        confirmLabel="Clear data"
        pending={forgetting}
        onConfirm={() => void forget()}
      >
        <p className="text-on-surface-variant">
          This removes offline copies of your entries and photos from this device. Your journals
          are safe, and changes still waiting to sync are kept.
        </p>
      </ConfirmDialog>
    </div>
  )
}

/**
 * What this site stores on the device, in three parts: entries (the local database), the photos
 * kept for offline journals, and everything else the browser holds for the app (its scripts,
 * fonts and recently viewed photos). The browser's own limit is a share of free disk space, so it
 * is a big, arbitrary-looking number; it is only mentioned when it is close.
 */
function StorageGauge({ use, photoBytes }: { use: StorageUse; photoBytes: number }) {
  const known = use.data !== null && use.files !== null
  const entries = use.data ?? 0
  const photos = Math.min(photoBytes, use.files ?? 0)
  const app = Math.max((use.files ?? 0) - photos, 0)
  const sum = entries + photos + app || 1
  const nearFull = use.total / use.quota > 0.8
  const parts = [
    { label: 'Entries', bytes: entries, color: 'bg-primary' },
    { label: 'Photos', bytes: photos, color: 'bg-tertiary' },
    { label: 'App files', bytes: app, color: 'bg-outline' },
  ]
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-surface-container-low p-4">
      <div className="flex items-baseline justify-between">
        <p className="text-lg">Storage on this device</p>
        <p className="text-lg">{formatBytes(use.total)}</p>
      </div>
      {known && (
        <>
          <div
            role="img"
            aria-label={parts.map((p) => `${p.label} ${formatBytes(p.bytes)}`).join(', ')}
            className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-surface-container-highest"
          >
            {parts.map((p) => (
              <span
                key={p.label}
                className={p.color}
                style={{ width: `${(p.bytes / sum) * 100}%` }}
              />
            ))}
          </div>
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-on-surface-variant">
            {parts.map((p) => (
              <span key={p.label} className="flex items-center gap-2">
                <span aria-hidden="true" className={`size-2 rounded-full ${p.color}`} />
                {p.label} {formatBytes(p.bytes)}
              </span>
            ))}
          </p>
        </>
      )}
      {nearFull && (
        <p role="alert" className="text-sm text-error">
          Your browser’s storage for Cairn is nearly full ({formatBytes(use.quota)} limit). Keep
          fewer journals on this device to free space.
        </p>
      )}
    </div>
  )
}
