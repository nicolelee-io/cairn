import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Icon } from '../components/Icon.tsx'
import { AttachmentView } from '../components/AttachmentView.tsx'
import { JournalChip } from '../components/JournalBadge.tsx'
import { Lightbox } from '../components/Lightbox.tsx'
import { Markdown, PhotoImage } from '../components/Markdown.tsx'
import { EntryWhen, MetaChip } from '../components/MetaChip.tsx'
import { NeedsConnection } from '../components/NeedsConnection.tsx'
import { LoadingState } from '../components/Spinner.tsx'
import { WeatherChip } from '../components/WeatherChip.tsx'
import { Button } from '../components/ui/button.tsx'
import { ApiError } from '../lib/api.ts'
import { locationLabel } from '../lib/location.ts'
import { useJournal } from '../lib/queries.ts'
import { useServerDown } from '../lib/serverStatus.ts'
import { useTrashEntry } from '../lib/trash.ts'
import { Page } from './Page.tsx'
import { PurgeDialog, deletedLine, useRestore } from './TrashPage.tsx'
import { restoreEntry } from '../lib/trash.ts'
import { entryLabel, summarize } from '@cairn/shared'

/**
 * A deleted entry, read-only (`/trash/:id`), so you can see what it is before restoring it or
 * deleting it for good. Needs the server, like the rest of the trash.
 */
export function TrashEntryPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const down = useServerDown()
  const query = useTrashEntry(id)
  const journal = useJournal(query.data?.entry.journalId)
  const restore = useRestore(() => restoreEntry(id), 'Entry restored', journal)
  const [viewing, setViewing] = useState<string | null>(null)
  const [purging, setPurging] = useState(false)

  const d = query.data
  const gone = query.error instanceof ApiError && query.error.status === 404

  return (
    <Page title="Deleted entry" icon="delete" back>
      {down ? (
        <NeedsConnection onRetry={() => void query.refetch()} />
      ) : query.isPending ? (
        <LoadingState label="Loading the entry" />
      ) : !d ? (
        <p role="alert">
          {gone ? 'This entry is no longer in Trash.' : 'Couldn’t load this entry.'}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-sm text-on-surface-variant">
              {deletedLine(d.deletedAt, d.purgeAt)}
            </p>
            <Button
              variant="tonal"
              disabled={restore.isPending}
              onClick={() =>
                restore.mutate(undefined, {
                  onSuccess: () => void navigate(`/entry/${id}`, { replace: true }),
                })
              }
            >
              <Icon name="undo" className="size-5" />
              Restore
            </Button>
            <Button variant="outlined" onClick={() => setPurging(true)}>
              Delete forever
            </Button>
          </div>

          <article className="flex flex-col gap-5">
            {d.entry.bodyMd.trim() ? (
              <Markdown
                body={d.entry.bodyMd}
                photos={d.photos}
                attachments={d.attachments}
                onOpenPhoto={setViewing}
              />
            ) : (
              <p className="text-on-surface-variant italic">No text.</p>
            )}
            {d.photos
              .filter((p) => !d.entry.bodyMd.includes(`photo:${p.id}`))
              .map((p) => (
                <PhotoImage key={p.id} id={p.id} alt="" photo={p} onOpen={setViewing} />
              ))}
            {d.attachments
              .filter((a) => !d.entry.bodyMd.includes(`attachment:${a.id}`))
              .map((a) => (
                <AttachmentView key={a.id} id={a.id} name={a.filename} attachment={a} />
              ))}

            <footer className="flex flex-col gap-3 border-t border-outline-variant pt-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                {journal && <JournalChip journal={journal} variant="footer" />}
                <MetaChip icon="calendar_month">
                  <EntryWhen {...d.entry} />
                </MetaChip>
                {d.location && (
                  <MetaChip icon="location_on" active>
                    <span className="truncate">{locationLabel(d.location)}</span>
                  </MetaChip>
                )}
                {d.weather && (
                  <MetaChip>
                    <WeatherChip
                      condition={d.weather.condition}
                      isDay={d.weather.isDay}
                      tempC={d.weather.tempC}
                      plain
                    />
                  </MetaChip>
                )}
              </div>
              {d.tags.length > 0 && (
                <ul className="flex flex-wrap gap-2" aria-label="Tags">
                  {d.tags.map((t) => (
                    <li
                      key={t}
                      className="rounded-sm bg-secondary-container px-2.5 py-1 text-on-secondary-container"
                    >
                      {t}
                    </li>
                  ))}
                </ul>
              )}
            </footer>
          </article>

          <Lightbox
            photos={d.photos}
            openId={viewing}
            onClose={() => setViewing(null)}
            onChange={setViewing}
          />
          {purging && (
            <PurgeDialog
              doomed={{
                kind: 'entry',
                id,
                label: entryLabel(summarize(d.entry.bodyMd)),
              }}
              onClose={() => setPurging(false)}
              onDone={() => void navigate('/trash', { replace: true })}
            />
          )}
        </>
      )}
    </Page>
  )
}
