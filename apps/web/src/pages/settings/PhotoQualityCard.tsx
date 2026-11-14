import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  AdminPhotosSchema,
  COMPRESSED_EDGE,
  type AdminPhotos,
  type PhotoQuality,
} from '@cairn/shared'
import { Button } from '../../components/ui/button.tsx'
import { ConfirmDialog } from '../../components/ui/dialog.tsx'
import { Switch } from '../../components/ui/switch.tsx'
import { api, errorCode } from '../../lib/api.ts'
import { formatBytes } from '../../lib/bytes.ts'
import { plural } from '../../lib/format.ts'
import { keys, useAdminPhotos } from '../../lib/queries.ts'
import { ago } from '../../lib/relativeTime.ts'

/** Server-wide: whether new photos keep their original file, and compressing the existing ones. */
export function PhotoQualityCard() {
  const qc = useQueryClient()
  const state = useAdminPhotos().data
  const done = (s: AdminPhotos) => qc.setQueryData(keys.adminPhotos, s)
  const save = useMutation({
    mutationFn: (quality: PhotoQuality) =>
      api('/admin/photos', { method: 'PUT', body: { quality }, schema: AdminPhotosSchema }),
    onSuccess: done,
  })
  if (!state) return null
  const original = state.quality === 'original'
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-surface-container-low p-4">
      <div className="flex items-center gap-4">
        <p className="flex-1 text-lg">Keep original photo quality</p>
        <Switch
          checked={original}
          label="Keep original photo quality"
          disabled={save.isPending}
          onChange={(on) => save.mutate(on ? 'original' : 'compressed')}
        />
      </div>
      <p className="text-sm text-on-surface-variant">
        {original
          ? 'New photos are kept exactly as they were uploaded or imported.'
          : `New JPEG and PNG photos are saved as smaller JPEGs (up to ${COMPRESSED_EDGE} px), keeping their date and location. Other formats (WebP, GIF, AVIF, TIFF) and photos with transparency are left alone.`}{' '}
        Applies to everyone&apos;s photos.
      </p>
      {save.isError && (
        <p role="alert" className="text-sm text-error">
          Couldn’t save the setting.
        </p>
      )}
      {!original && <CompressExisting state={state} onDone={done} />}
    </div>
  )
}

function CompressExisting({
  state,
  onDone,
}: {
  state: AdminPhotos
  onDone: (s: AdminPhotos) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const start = useMutation({
    mutationFn: () => api('/admin/photos/compress', { method: 'POST', schema: AdminPhotosSchema }),
    onSuccess: onDone,
    onSettled: () => setConfirming(false),
  })
  const { candidates, job, lastBackupAt, backupFresh: backupOk } = state
  const running = job.state === 'running'
  const refused = errorCode(start.error) === 'backup_needed'

  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-outline-variant pt-3">
      <p>Compress existing photos</p>
      <p className="text-sm text-on-surface-variant">
        {candidates.files === 0
          ? 'No original JPEG or PNG files are left.'
          : `${plural(candidates.files, 'photo takes', 'photos take')} ${formatBytes(candidates.bytes)} and can be compressed. Photos that wouldn’t get clearly smaller are skipped.`}
      </p>
      {running ? (
        <p role="status" className="text-sm">
          Compressing… {job.done} of {job.total}, {formatBytes(job.savedBytes)} saved so far.
        </p>
      ) : (
        job.state !== 'idle' && (
          <p role="status" className={job.state === 'failed' ? 'text-sm text-error' : 'text-sm'}>
            {job.state === 'failed'
              ? `Stopped after ${job.done} of ${job.total}${job.error ? `: ${job.error}` : '.'}`
              : `Done: ${plural(job.compressed, 'photo', 'photos')} compressed, ${formatBytes(job.savedBytes)} saved${job.kept ? `, ${job.kept} kept as they were` : ''}${job.failed ? `, ${job.failed} couldn’t be read` : ''}.`}
          </p>
        )
      )}
      {(!backupOk || refused) && (
        <p role={refused ? 'alert' : undefined} className="text-sm text-error">
          Needs a backup from the last 24 hours first, because the originals are deleted.{' '}
          {lastBackupAt ? `The last one was ${ago(lastBackupAt)}.` : 'No backup has reported in.'}
        </p>
      )}
      {start.isError && !refused && (
        <p role="alert" className="text-sm text-error">
          Couldn’t start compressing.
        </p>
      )}
      <Button
        variant="tonal"
        className="self-start"
        disabled={!backupOk || running || candidates.files === 0 || start.isPending}
        onClick={() => setConfirming(true)}
      >
        Compress existing photos
      </Button>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Compress existing photos?"
        confirmLabel="Compress"
        destructive={false}
        pending={start.isPending}
        onConfirm={() => start.mutate()}
      >
        <p className="text-on-surface-variant">
          This replaces the original files of up to {plural(candidates.files, 'photo', 'photos')},
          for every user, with compressed copies. You can only get the originals back from a
          backup.
        </p>
      </ConfirmDialog>
    </div>
  )
}
