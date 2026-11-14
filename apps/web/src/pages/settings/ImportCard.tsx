import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import {
  ATTACHMENT_MAX_MB,
  ImportJobSchema,
  type ImportJob,
  type ImportPreview,
  type ImportResult,
} from '@cairn/shared'
import { useMe } from '../../auth/useAuth.ts'
import { Icon } from '../../components/Icon.tsx'
import { LoadingState } from '../../components/Spinner.tsx'
import { NeedsConnection } from '../../components/NeedsConnection.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Switch } from '../../components/ui/switch.tsx'
import { api } from '../../lib/api.ts'
import { formatBytes } from '../../lib/bytes.ts'
import { plural } from '../../lib/format.ts'
import {
  invalidateAfterSave,
  keys,
  useAttachmentLimit,
  useImportStatus,
} from '../../lib/queries.ts'
import { useServerDown } from '../../lib/serverStatus.ts'
import { syncNow } from '../../lib/sync.ts'
import { UploadError, uploadImport } from '../../lib/upload.ts'

const CARD = 'flex flex-col gap-3 rounded-lg bg-surface-container-low p-4'

/**
 * Settings > Import: upload an export zip (Day One's JSON export, or Cairn's own), check what it
 * holds, then import it into this account. The run happens on the server, so the page can be
 * left and come back to; the status is polled while it runs.
 */
export function ImportCard() {
  const qc = useQueryClient()
  const down = useServerDown()
  const status = useImportStatus()
  const userId = useMe().data?.id
  const job = status.data?.job ?? null

  // When a run finishes, lists, counts and the device's offline copy pick up the new entries.
  const wasRunning = useRef(false)
  useEffect(() => {
    const running = job?.state === 'running'
    if (wasRunning.current && !running) {
      invalidateAfterSave(qc)
      if (userId) void syncNow(userId, qc)
    }
    wasRunning.current = running
  }, [job?.state, qc, userId])

  if (down) return <NeedsConnection onRetry={() => void status.refetch()} />
  if (!status.data) return <LoadingState />
  const { staged, busy } = status.data

  return (
    <>
      {job?.state === 'running' ? (
        <Running job={job} />
      ) : staged ? (
        <Preview preview={staged} busy={busy} />
      ) : (
        <Upload />
      )}
      {job && job.state !== 'running' && <LastRun job={job} />}
    </>
  )
}

/** The intro and the file picker, with upload progress. */
function Upload() {
  const qc = useQueryClient()
  const maxMb = useAttachmentLimit().data?.maxMb ?? ATTACHMENT_MAX_MB
  const input = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const choose = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    setProgress(0)
    try {
      const preview = await uploadImport(file, maxMb, setProgress)
      qc.setQueryData(keys.importStatus, (s: { staged: ImportPreview } | undefined) =>
        s ? { ...s, staged: preview } : s,
      )
    } catch (e) {
      setError(e instanceof UploadError ? e.message : 'The upload failed. Try again.')
    } finally {
      setProgress(null)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div className={CARD}>
      <div>
        <p className="text-lg">Import</p>
        <p className="text-sm text-on-surface-variant">
          Bring in journals from a Day One JSON export, or from a Cairn export. Journals with the
          same name are added to; entries already here are skipped, so importing the same file again
          is safe. You’ll see what the file holds before anything is imported.
        </p>
        <p className="mt-2 text-sm text-on-surface-variant">
          Files up to {maxMb} MB. A larger export, one with lots of photos or video, can be imported
          from the server’s command line.
        </p>
      </div>
      <input
        ref={input}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={(e) => void choose(e.target.files?.[0])}
      />
      {progress !== null ? (
        <div role="status" className="flex flex-col gap-1 text-sm">
          <span>
            {progress < 1 ? `Uploading… ${Math.round(progress * 100)}%` : 'Reading the export…'}
          </span>
          <progress value={progress} className="h-1 w-full accent-primary" />
        </div>
      ) : (
        <Button className="self-start" onClick={() => input.current?.click()}>
          <Icon name="upload_file" />
          Choose a zip…
        </Button>
      )}
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
    </div>
  )
}

/** What the upload holds, the journals to archive, and Import or Cancel. */
function Preview({ preview, busy }: { preview: ImportPreview; busy: boolean }) {
  const qc = useQueryClient()
  // New journals to import as archived (the CLI's --archived). A journal that exists keeps its
  // own state, and one the export marks archived (a Cairn export) arrives archived anyway, so
  // only the others get a switch.
  const [archived, setArchived] = useState<Set<string>>(() => new Set())
  const start = useMutation({
    mutationFn: () =>
      api(`/import/${preview.id}/start`, {
        method: 'POST',
        body: { archived: [...archived] },
        schema: ImportJobSchema,
      }),
    onSuccess: (job) => qc.setQueryData(keys.importStatus, { staged: null, job, busy: false }),
    onError: () => void qc.invalidateQueries({ queryKey: keys.importStatus }),
  })
  const cancel = useMutation({
    mutationFn: () => api(`/import/${preview.id}`, { method: 'DELETE' }),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.importStatus }),
  })
  const total = preview.journals.reduce((n, j) => n + j.entries, 0)
  const fresh = total - preview.journals.reduce((n, j) => n + j.alreadyImported, 0)
  const media = [
    preview.photos ? plural(preview.photos, 'photo', 'photos') : null,
    preview.attachments ? plural(preview.attachments, 'file', 'files') : null,
  ].filter(Boolean)

  return (
    <div className={CARD}>
      <div>
        <p className="text-lg">Ready to import</p>
        <p className="text-sm break-all text-on-surface-variant">
          {preview.filename} · {formatBytes(preview.bytes)}
        </p>
      </div>
      <p className="text-sm">
        {fresh === 0
          ? `All ${plural(total, 'entry', 'entries')} in this export are already here, so nothing would be added.`
          : `${plural(fresh, 'new entry', 'new entries')}${fresh < total ? ` of ${total}` : ''} in ${plural(preview.journals.length, 'journal', 'journals')}${media.length ? `, with ${media.join(' and ')} in the export` : ''}.`}
      </p>
      <ul className="flex flex-col divide-y divide-outline-variant">
        {preview.journals.map((j) => (
          <li key={j.name} className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate">{j.name}</p>
              <p className="text-sm text-on-surface-variant">
                {plural(j.entries, 'entry', 'entries')}
                {j.alreadyImported > 0 &&
                  ` · ${j.alreadyImported === j.entries ? 'all' : j.alreadyImported} already here`}
                {j.exists ? ' · adds to your journal' : ' · new journal'}
                {j.archived && ', archived'}
              </p>
            </div>
            {!j.exists && !j.archived && (
              <>
                <span className="text-sm text-on-surface-variant">Archive</span>
                <Switch
                  label={`Import ${j.name} as archived`}
                  checked={archived.has(j.name)}
                  onChange={(on) =>
                    setArchived((s) => {
                      const next = new Set(s)
                      if (on) next.add(j.name)
                      else next.delete(j.name)
                      return next
                    })
                  }
                />
              </>
            )}
          </li>
        ))}
      </ul>
      {busy && (
        <p role="status" className="text-sm text-on-surface-variant">
          Another import is running on the server. You can start this one when it has finished.
        </p>
      )}
      {start.isError && !busy && (
        <p role="alert" className="text-sm text-error">
          Couldn’t start the import. Try again.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy || fresh === 0 || start.isPending || cancel.isPending}
          onClick={() => start.mutate()}
        >
          {start.isPending ? 'Starting…' : 'Import'}
        </Button>
        <Button
          variant="text"
          disabled={start.isPending || cancel.isPending}
          onClick={() => cancel.mutate()}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}

function Running({ job }: { job: ImportJob }) {
  return (
    <div className={CARD}>
      <p className="text-lg">Importing {job.filename}</p>
      <div role="status" className="flex flex-col gap-1 text-sm">
        <span>
          {job.done} of {plural(job.total, 'entry', 'entries')}
        </span>
        <progress
          value={job.total ? job.done / job.total : 0}
          className="h-1 w-full accent-primary"
        />
      </div>
      <p className="text-sm text-on-surface-variant">
        You can leave this page; the import carries on on the server.
      </p>
    </div>
  )
}

/** The finished (or stopped) run's report. */
function LastRun({ job }: { job: ImportJob }) {
  const r = job.report
  return (
    <div className={CARD}>
      <div>
        <p className="text-lg">
          {job.state === 'failed' ? 'The last import stopped' : 'Last import'}
        </p>
        <p className="text-sm break-all text-on-surface-variant">{job.filename}</p>
      </div>
      {job.state === 'failed' && (
        <p role="alert" className="text-sm text-error">
          {job.error} It stopped after {job.done} of {plural(job.total, 'entry', 'entries')}.
          Entries imported before that are kept; upload the same file again to finish.
        </p>
      )}
      {r && <Report report={r} />}
    </div>
  )
}

function Report({ report: r }: { report: ImportResult }) {
  const imported = r.journals.reduce((n, j) => n + j.imported, 0)
  const skipped = r.journals.reduce((n, j) => n + j.skipped, 0)
  const missing = r.photosMissing + r.attachmentsMissing
  return (
    <>
      <p className="text-sm">
        {plural(imported, 'entry', 'entries')} imported
        {skipped > 0 && `, ${skipped} already here`}
        {r.failureCount > 0 && `, ${r.failureCount} couldn’t be read`}.{' '}
        {r.photosImported + r.attachmentsImported > 0 &&
          `${plural(r.photosImported, 'photo', 'photos')} and ${plural(r.attachmentsImported, 'file', 'files')} added.`}
      </p>
      <ul className="flex flex-col gap-1 text-sm text-on-surface-variant">
        {r.journals.map((j) => (
          <li key={j.name}>
            {j.name}
            {j.archived && ' (archived)'}: {j.imported} imported
            {j.skipped > 0 && `, ${j.skipped} skipped`}
            {j.failed > 0 && `, ${j.failed} failed`}
          </li>
        ))}
      </ul>
      {missing > 0 && (
        <p className="text-sm text-on-surface-variant">
          {plural(missing, 'photo or file was', 'photos or files were')} listed in the export but
          not in the zip (an export made without media leaves them out).
        </p>
      )}
      {r.failureCount > 0 && (
        <Details
          title={plural(r.failureCount, 'entry couldn’t be read', 'entries couldn’t be read')}
        >
          {r.failures.map((f) => `${f.journal} ${f.id}: ${f.error}`)}
        </Details>
      )}
      {r.warningCount > 0 && (
        <Details title={plural(r.warningCount, 'note', 'notes')}>{r.warnings}</Details>
      )}
    </>
  )
}

function Details({ title, children }: { title: string; children: string[] }) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-primary">{title}</summary>
      <ul className="mt-1 flex flex-col gap-1 break-all text-on-surface-variant">
        {children.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </details>
  )
}
