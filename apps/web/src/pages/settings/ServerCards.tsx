import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ATTACHMENT_MAX_MB, AttachmentLimitSchema, GoogleKeyStatusSchema } from '@cairn/shared'
import { api } from '../../lib/api.ts'
import { keys, useAttachmentLimit, useBackupStatus, useGoogleKey } from '../../lib/queries.ts'
import { ago } from '../../lib/relativeTime.ts'
import { Button } from '../../components/ui/button.tsx'

export function GoogleKeyCard() {
  const qc = useQueryClient()
  const status = useGoogleKey().data
  const [key, setKey] = useState('')
  const done = (s: unknown) => {
    qc.setQueryData(keys.googleKey, s)
    setKey('')
  }
  const save = useMutation({
    mutationFn: () =>
      api('/places/key', { method: 'PUT', body: { key }, schema: GoogleKeyStatusSchema }),
    onSuccess: done,
  })
  const remove = useMutation({
    mutationFn: () => api('/places/key', { method: 'DELETE', schema: GoogleKeyStatusSchema }),
    onSuccess: done,
  })
  return (
    <form
      className="flex flex-col gap-2 rounded-lg bg-surface-container-low p-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (key.trim().length >= 10) save.mutate()
      }}
    >
      <p className="text-lg">Google API key</p>
      <p className="text-sm text-on-surface-variant">
        Powers place search and naming a location from its coordinates, so it needs the Places (New)
        and Geocoding APIs enabled. The Weather API is optional: only turn it on if you choose
        Google as the weather source below.{' '}
        {status?.configured
          ? status.source === 'settings'
            ? `A key ending in ${status.hint} is saved here.`
            : `Using the key ending in ${status.hint} from the install settings. A key saved here replaces it.`
          : 'No key yet.'}
      </p>
      <input
        type="password"
        autoComplete="off"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder={status?.configured ? 'Paste a new key to replace it' : 'Paste your key'}
        aria-label="Google API key"
        className="h-12 w-full rounded-sm border border-input bg-transparent px-4 text-base outline-none placeholder:text-on-surface-variant focus-visible:border-primary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
      />
      {(save.isError || remove.isError) && (
        <p role="alert" className="text-sm text-error">
          Couldn’t save the key. Check that it’s at least 10 characters.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={key.trim().length < 10 || save.isPending}>
          Save key
        </Button>
        {status?.source === 'settings' && (
          <Button variant="text" disabled={remove.isPending} onClick={() => remove.mutate()}>
            Remove saved key
          </Button>
        )}
      </div>
    </form>
  )
}

/** Instance-wide, like the Google key: how big an attachment upload may be. */
export function AttachmentLimitCard() {
  const qc = useQueryClient()
  const current = useAttachmentLimit().data?.maxMb
  const [mb, setMb] = useState('')
  const save = useMutation({
    mutationFn: (maxMb: number) =>
      api('/attachments/limit', { method: 'PUT', body: { maxMb }, schema: AttachmentLimitSchema }),
    onSuccess: (s) => {
      qc.setQueryData(keys.attachmentLimit, s)
      setMb('')
    },
  })
  const value = Number(mb)
  const valid = Number.isInteger(value) && value >= 1 && value <= ATTACHMENT_MAX_MB
  return (
    <form
      className="flex flex-col gap-2 rounded-lg bg-surface-container-low p-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) save.mutate(value)
      }}
    >
      <p className="text-lg">Attachment size limit</p>
      <p className="text-sm text-on-surface-variant">
        The largest PDF, video or audio file you can add to an entry
        {current ? ` (now ${current} MB)` : ''}. The maximum is {ATTACHMENT_MAX_MB} MB.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={ATTACHMENT_MAX_MB}
          value={mb}
          onChange={(e) => setMb(e.target.value)}
          placeholder={current ? String(current) : ''}
          aria-label="Attachment size limit in MB"
          className="h-12 w-28 rounded-sm border border-input bg-transparent px-4 text-base outline-none placeholder:text-on-surface-variant focus-visible:border-primary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
        />
        <span className="text-sm text-on-surface-variant">MB</span>
        <Button type="submit" disabled={!valid || save.isPending}>
          Save limit
        </Button>
      </div>
      {save.isError && (
        <p role="alert" className="text-sm text-error">
          Couldn’t save the limit.
        </p>
      )}
    </form>
  )
}

export function BackupCard() {
  const s = useBackupStatus().data
  if (!s) return null
  const bad = s.state === 'failing' || s.state === 'stale'
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-surface-container-low p-4">
      <p className="text-lg">Server backup</p>
      {s.state === 'none' ? (
        <p className="text-sm text-on-surface-variant">
          No backups yet. Once backups are set up (see docs/backup.md), their status shows here.
        </p>
      ) : (
        <>
          <p className={bad ? 'text-sm text-error' : 'text-sm text-on-surface-variant'}>
            {s.state === 'failing'
              ? `The last backup failed ${ago(s.lastRunAt!)}${s.lastRunError ? `: ${s.lastRunError.replace(/[.\s]*$/, '.')}` : '.'}`
              : s.state === 'stale'
                ? s.lastSuccessAt
                  ? `No successful backup since ${ago(s.lastSuccessAt)}.`
                  : 'No backup has succeeded yet.'
                : `Last backup ${ago(s.lastSuccessAt!)}.`}
            {s.state === 'failing' && s.lastSuccessAt && ` Last good one: ${ago(s.lastSuccessAt)}.`}
          </p>
          <p
            className={
              s.lastVerifyOk === false ? 'text-sm text-error' : 'text-sm text-on-surface-variant'
            }
          >
            {s.lastVerifyAt === null
              ? 'Never test-restored. Try a test restore to make sure your backups work (docs/backup.md).'
              : s.lastVerifyOk
                ? `Test restore passed ${ago(s.lastVerifyAt)}.`
                : `Test restore failed ${ago(s.lastVerifyAt)}${s.lastVerifyError ? `: ${s.lastVerifyError.replace(/[.\s]*$/, '.')}` : '.'}`}
          </p>
        </>
      )}
    </div>
  )
}
