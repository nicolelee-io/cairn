import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { CleanupReportSchema, type AdminStorage, type StorageUsage } from '@cairn/shared'
import { useMe } from '../auth/useAuth.ts'
import { JournalBadge } from '../components/JournalBadge.tsx'
import { NeedsConnection } from '../components/NeedsConnection.tsx'
import { Button } from '../components/ui/button.tsx'
import { api } from '../lib/api.ts'
import { formatBytes } from '../lib/bytes.ts'
import {
  keys,
  useAdminStorage,
  useCleanupPreview,
  useJournals,
  useStorage,
} from '../lib/queries.ts'
import { useServerDown } from '../lib/serverStatus.ts'
import { plural } from '../lib/format.ts'
import { LoadingState } from '../components/Spinner.tsx'
import { Page } from './Page.tsx'

const joined = (parts: (string | false | null)[]) => parts.filter(Boolean).join(' · ')

/** One labelled size, with an optional line of detail under the label. */
function SizeRow({
  lead,
  label,
  bytes,
  detail,
}: {
  /** Beside both lines (a journal's badge). */
  lead?: ReactNode
  label: ReactNode
  bytes: number
  detail?: string
}) {
  return (
    <li className="flex items-baseline gap-4 py-2">
      {lead && <span className="self-center">{lead}</span>}
      <div className="min-w-0 flex-1">
        <p className="truncate">{label}</p>
        {detail && <p className="text-sm text-on-surface-variant">{detail}</p>}
      </div>
      <span className="shrink-0 tabular-nums">{formatBytes(bytes)}</span>
    </li>
  )
}

/** A card whose title line can carry a total on the right, lined up with the rows' sizes. */
function Card({ title, total, children }: { title: string; total?: number; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1 rounded-lg bg-surface-container-low p-4">
      <div className="flex items-baseline gap-4">
        <h2 className="flex-1 text-lg">{title}</h2>
        {total !== undefined && (
          <span className="shrink-0 text-lg font-medium tabular-nums">{formatBytes(total)}</span>
        )}
      </div>
      {children}
    </section>
  )
}

/** Storage: what your journals and files take on the server, per journal. */
export function StoragePage() {
  const usage = useStorage()
  const down = useServerDown()
  return (
    <Page title="Storage" icon="hard_drive" back>
      {down ? (
        <NeedsConnection onRetry={() => void usage.refetch()} />
      ) : usage.isPending ? (
        <LoadingState label="Measuring" />
      ) : usage.isError ? (
        <p role="alert">Couldn’t load storage.</p>
      ) : (
        <Usage usage={usage.data} />
      )}
    </Page>
  )
}

function Usage({ usage }: { usage: StorageUsage }) {
  const journals = useJournals().data ?? []
  const days = useMe().data?.trashRetentionDays ?? 60
  const { photos, attachments: files, pending, trash } = usage
  const rows = usage.journals
    .map((j) => ({
      ...j,
      journal: journals.find((x) => x.id === j.journalId),
      total: j.textBytes + j.photoBytes + j.attachmentBytes,
    }))
    .sort((a, b) => b.total - a.total)
  return (
    <>
      <Card title="On the server" total={usage.totalBytes}>
        <p className="text-sm text-on-surface-variant">
          Everything your account keeps on this server.
        </p>
        <ul className="flex flex-col divide-y divide-outline-variant">
          <SizeRow
            label={`Photos (${photos.count})`}
            bytes={photos.originalBytes + photos.copyBytes}
            detail={`${formatBytes(photos.originalBytes)} full size, ${formatBytes(photos.copyBytes)} resized`}
          />
          <SizeRow
            label={`Attachments (${files.count})`}
            bytes={files.videoBytes + files.audioBytes + files.pdfBytes}
            detail={
              joined([
                files.videoBytes > 0 && `Video ${formatBytes(files.videoBytes)}`,
                files.audioBytes > 0 && `Audio ${formatBytes(files.audioBytes)}`,
                files.pdfBytes > 0 && `PDF ${formatBytes(files.pdfBytes)}`,
              ]) || undefined
            }
          />
          <SizeRow label="Entry text" bytes={usage.textBytes} />
          {usage.avatarBytes > 0 && <SizeRow label="Profile picture" bytes={usage.avatarBytes} />}
          {trash.entries > 0 && (
            <li>
              <Link
                to="/trash"
                className="state-layer -mx-2 flex items-center gap-4 rounded-lg px-2 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-primary">In Trash</p>
                  <p className="text-sm text-on-surface-variant">
                    {joined([
                      plural(trash.entries, 'entry', 'entries'),
                      trash.files > 0 && plural(trash.files, 'file', 'files'),
                    ])}
                    . Deleted for good after {days} days, or when you empty Trash.
                  </p>
                </div>
                {/* No chevron, so the size lines up with the rows above; the label says it opens. */}
                <span className="shrink-0 tabular-nums">{formatBytes(trash.bytes)}</span>
              </Link>
            </li>
          )}
          {pending.bytes > 0 && (
            <SizeRow
              label="Waiting for cleanup"
              bytes={pending.bytes}
              detail={`${plural(pending.files, 'file', 'files')} no longer in use. They’re removed automatically every day.`}
            />
          )}
        </ul>
      </Card>
      <Card title="Journals">
        {rows.length === 0 ? (
          <p className="text-on-surface-variant">No journals yet.</p>
        ) : (
          <ul
            aria-label="Journals by size"
            className="flex flex-col divide-y divide-outline-variant"
          >
            {rows.map((j) => (
              <SizeRow
                key={j.journalId}
                bytes={j.total}
                lead={<JournalBadge journal={j.journal ?? { color: null, icon: null }} size="md" />}
                label={
                  <span className="flex items-center gap-3">
                    <span className="truncate">{j.journal?.name ?? 'Journal'}</span>
                    {j.journal?.archivedAt && (
                      <span className="text-sm text-on-surface-variant">Archived</span>
                    )}
                  </span>
                }
                detail={joined([
                  plural(j.entries, 'entry', 'entries'),
                  j.photos > 0 && plural(j.photos, 'photo', 'photos'),
                  j.attachments > 0 && plural(j.attachments, 'attachment', 'attachments'),
                ])}
              />
            ))}
          </ul>
        )}
        <p className="pt-2 text-sm text-on-surface-variant">
          A photo or file used in more than one journal counts in each of them, and once in your
          total.
        </p>
      </Card>
    </>
  )
}

/** Server storage (admins only): the database, snapshots, and each user's totals. */
export function ServerStoragePage() {
  const isAdmin = useMe().data?.role === 'admin'
  const report = useAdminStorage(isAdmin)
  const down = useServerDown()
  return (
    <Page title="Server storage" icon="hard_drive" back>
      {!isAdmin ? (
        <p className="rounded-lg bg-surface-container-low p-4 text-on-surface-variant">
          Only an admin can see the server&apos;s storage.
        </p>
      ) : down ? (
        <NeedsConnection onRetry={() => void report.refetch()} />
      ) : report.isPending ? (
        <LoadingState label="Measuring" />
      ) : report.isError ? (
        <p role="alert">Couldn’t load storage.</p>
      ) : (
        <ServerUsage report={report.data} />
      )}
    </Page>
  )
}

function Breakdown({ label, bytes }: { label: string; bytes: number }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className="text-right tabular-nums">{formatBytes(bytes)}</dd>
    </>
  )
}

function ServerUsage({ report }: { report: AdminStorage }) {
  const { server, users } = report
  const userTotal = users.reduce((n, u) => n + u.totalBytes, 0)
  const byTotal = [...users].sort((a, b) => b.totalBytes - a.totalBytes)
  return (
    <>
      <Card title="Cairn's data" total={userTotal + server.databaseBytes + server.backupsBytes}>
        <ul className="flex flex-col divide-y divide-outline-variant">
          <SizeRow label="Journals and files" bytes={userTotal} detail="Every user, below" />
          <SizeRow label="Database" bytes={server.databaseBytes} />
          <SizeRow
            label="Safety copies"
            bytes={server.backupsBytes}
            detail="Made before updates; the latest 5 are kept"
          />
        </ul>
        <p className="pt-2 text-sm text-on-surface-variant">
          Backups are stored elsewhere and aren&apos;t counted here.
        </p>
      </Card>
      <Card title="Users">
        <ul aria-label="Users by size" className="flex flex-col divide-y divide-outline-variant">
          {byTotal.map((u) => (
            <li key={u.id} className="flex flex-col gap-2 py-3">
              <div className="flex items-baseline gap-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate">{u.displayName}</p>
                  <p className="truncate text-sm text-on-surface-variant">{u.username}</p>
                </div>
                <span className="shrink-0 font-medium tabular-nums">
                  {formatBytes(u.totalBytes)}
                </span>
              </div>
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm text-on-surface-variant">
                <Breakdown label="Photos" bytes={u.photoBytes} />
                <Breakdown label="Attachments" bytes={u.attachmentBytes} />
                <Breakdown label="Entry text" bytes={u.textBytes} />
                {u.trashBytes > 0 && <Breakdown label="In Trash" bytes={u.trashBytes} />}
                {u.pendingBytes > 0 && (
                  <Breakdown label="Waiting for cleanup" bytes={u.pendingBytes} />
                )}
              </dl>
            </li>
          ))}
        </ul>
        <p className="pt-2 text-sm text-on-surface-variant">
          Totals only: what anyone writes, and their journals, stay private to them.
        </p>
      </Card>
      <CleanupCard />
    </>
  )
}

/** The daily media cleanup: what it would do now (a dry run), and a button to run it. */
function CleanupCard() {
  const qc = useQueryClient()
  const preview = useCleanupPreview()
  const [freed, setFreed] = useState<number | null>(null)
  const run = useMutation({
    mutationFn: () => api('/admin/cleanup', { method: 'POST', schema: CleanupReportSchema }),
    onSuccess: (r) => {
      setFreed(r.bytes)
      for (const key of [keys.cleanupPreview, keys.adminStorage, keys.storage, keys.trash])
        void qc.invalidateQueries({ queryKey: key })
    },
  })
  const p = preview.data
  const days = useMe().data?.trashRetentionDays ?? 60
  const todo =
    p &&
    (p.bytes > 0 ||
      p.abandoned > 0 ||
      p.ofPurgedEntries > 0 ||
      p.expiredEntries > 0 ||
      p.expiredJournals > 0)
  return (
    <Card title="Cleanup">
      <p className="text-sm text-on-surface-variant">
        Cairn clears out old items every day. Run it now to free space sooner.
      </p>
      {preview.isError ? (
        <p role="alert" className="py-2">
          Couldn’t check what needs cleaning up.
        </p>
      ) : !p ? (
        <LoadingState label="Checking" className="py-4" />
      ) : (
        <ul className="flex flex-col divide-y divide-outline-variant">
          {todo ? (
            <SizeRow
              label="Ready to remove now"
              bytes={p.bytes}
              detail={joined([
                p.expiredEntries + p.expiredJournals > 0 &&
                  `${joined([
                    p.expiredJournals > 0 && plural(p.expiredJournals, 'journal', 'journals'),
                    p.expiredEntries > 0 && plural(p.expiredEntries, 'entry', 'entries'),
                  ])} in Trash past ${days} days`,
                p.files + p.ofPurgedEntries > 0 &&
                  `${plural(p.files + p.ofPurgedEntries, 'file', 'files')} of deleted items`,
                p.stray > 0 && `${plural(p.stray, 'unused file', 'unused files')}`,
                p.abandoned > 0 &&
                  plural(p.abandoned, 'unfinished upload', 'unfinished uploads'),
              ])}
            />
          ) : (
            <li className="py-2 text-on-surface-variant">Nothing to clean up right now.</li>
          )}
          {p.missing > 0 && (
            <li className="py-2 text-sm text-error">
              {plural(p.missing, 'photo or attachment is', 'photos or attachments are')} missing
              their file. Restoring from a backup brings them back.
            </li>
          )}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-3 pt-2">
        <Button
          variant="tonal"
          disabled={!todo || run.isPending}
          onClick={() => {
            setFreed(null)
            run.mutate()
          }}
        >
          {run.isPending ? 'Cleaning up…' : 'Clean up now'}
        </Button>
        {run.isError && <p role="alert">Cleanup failed.</p>}
        {freed !== null && (
          <p role="status" className="text-sm text-on-surface-variant">
            Done. Freed {formatBytes(freed)}.
          </p>
        )}
      </div>
    </Card>
  )
}
