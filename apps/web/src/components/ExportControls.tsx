import { useState } from 'react'
import { useServerDown } from '../lib/serverStatus.ts'
import { Icon } from './Icon.tsx'
import { OfflineNote } from './NeedsConnection.tsx'
import { Button, buttonVariants } from './ui/button.tsx'
import { Switch } from './ui/switch.tsx'

/**
 * The photos switch and the download link. It is a plain link to the export route, so the browser
 * does the download; `journalId` limits the export to one journal (omit for all of them).
 */
export function ExportControls({ journalId }: { journalId?: string }) {
  const [media, setMedia] = useState(true)
  const down = useServerDown()
  const params = new URLSearchParams()
  if (journalId) params.set('journalId', journalId)
  if (!media) params.set('media', '0')
  const query = params.size ? `?${params}` : ''
  return (
    <>
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <p>Include photos</p>
          <p className="text-sm text-on-surface-variant">
            Include original photo files. Turn off for a smaller, text-only export.
          </p>
        </div>
        <Switch checked={media} label="Include photos" onChange={setMedia} />
      </div>
      {/* Offline the browser would fail the download, or save the gateway's error page as the file. */}
      {down ? (
        <>
          <Button variant="tonal" className="w-full" disabled>
            <Icon name="download" className="size-5" />
            Export
          </Button>
          <OfflineNote>Reconnect to export.</OfflineNote>
        </>
      ) : (
        <a
          href={`/api/export${query}`}
          download
          className={buttonVariants({ variant: 'tonal', className: 'w-full' })}
        >
          <Icon name="download" className="size-5" />
          Export
        </a>
      )}
      <p className="text-sm text-on-surface-variant">
        Large libraries can take a while to start downloading.
      </p>
    </>
  )
}
