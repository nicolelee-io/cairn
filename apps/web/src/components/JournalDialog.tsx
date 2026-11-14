import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { isJournalIconName, JOURNAL_ICONS, type Journal } from '@cairn/shared'
import { useMe, useUpdateMe } from '../auth/useAuth.ts'
import { Icon } from './Icon.tsx'
import { JournalBadge } from './JournalBadge.tsx'
import { Button } from './ui/button.tsx'
import { JournalDeleteDialog, JournalExportDialog } from './JournalConfirmDialogs.tsx'
import { ConfirmDialog, Dialog, DialogActions } from './ui/dialog.tsx'
import { Input } from './ui/input.tsx'
import { Switch } from './ui/switch.tsx'
import { useOfflineControls } from '../lib/useOfflineControls.ts'
import { createJournal, updateJournal } from '../lib/journalWrites.ts'
import { ApiError } from '../lib/api.ts'
import { isUnreachable } from '../lib/outbox.ts'
import { cn } from '../lib/cn.ts'
import { firstEmoji } from '../lib/journalIcons.ts'
import { JOURNAL_COLORS, nextJournalColor } from '../lib/journalColors.ts'
import { invalidateAfterSave, invalidateMe, useJournals } from '../lib/queries.ts'

/** Create (journal null) or edit a journal; shared by Manage journals and the nav's +. */
export function JournalDialog({
  journal,
  open,
  isDefault,
  onClose,
}: {
  journal: Journal | null // null = creating
  open: boolean
  isDefault: boolean
  onClose: () => void
}) {
  const qc = useQueryClient()
  const updateMe = useUpdateMe()
  const me = useMe().data
  const journals = useJournals().data
  const [name, setName] = useState(journal?.name ?? '')
  const [color, setColor] = useState<string | null>(
    journal?.color ??
      (journal ? JOURNAL_COLORS[0] : nextJournalColor(journals?.map((j) => j.color) ?? [])),
  )
  const [icon, setIcon] = useState<string | null>(journal?.icon ?? null)
  const [pickingIcon, setPickingIcon] = useState(false)
  const [description, setDescription] = useState(journal?.description ?? '')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  // What the form opened with, to tell unsaved edits from none (the colour of a new journal is
  // preselected, so it counts as the start, not as an edit).
  const [initial] = useState({ name, color, icon, description })
  const dirty =
    name !== initial.name ||
    color !== initial.color ||
    icon !== initial.icon ||
    description !== initial.description
  // Esc and a click outside are easy to do by accident; Cancel is deliberate and closes at once.
  const dismiss = () => (dirty ? setConfirmingDiscard(true) : onClose())

  // Archiving, deleting and renaming all change what the timeline and the default can show.
  const refresh = () => {
    invalidateAfterSave(qc)
    invalidateMe(qc)
  }
  const done = () => {
    refresh()
    onClose()
  }

  // Offline these wait in the outbox and the journal list shows them meanwhile (lib/journalWrites.ts).
  const save = useMutation({
    mutationFn: () =>
      journal
        ? updateJournal(me?.id, journal.id, { name, color, icon, description })
        : createJournal(me?.id, { name, color, icon, description }),
    onSuccess: done,
  })
  const archive = useMutation({
    mutationFn: (archived: boolean) => updateJournal(me?.id, journal!.id, { archived }),
    onSuccess: done,
  })

  const error = [save, archive, updateMe].find((m) => m.error)?.error
  const busy = save.isPending || archive.isPending || updateMe.isPending

  function submit(e: FormEvent) {
    e.preventDefault()
    if (name.trim()) save.mutate()
  }

  return (
    <>
      <Dialog
        open={open && !confirmingDelete && !exporting && !confirmingDiscard}
        onClose={dismiss}
        title={journal ? 'Edit journal' : 'New journal'}
      >
        <form onSubmit={submit} className="flex flex-col gap-4">
          {/* The badge is the icon picker's button: the grid stays folded until it is wanted. */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Choose icon"
              aria-expanded={pickingIcon}
              onClick={() => setPickingIcon(!pickingIcon)}
              className={cn(
                'state-layer relative shrink-0 rounded-full',
                pickingIcon && 'outline-2 outline-offset-2 outline-primary',
              )}
            >
              <JournalBadge journal={{ color, icon }} size="md" />
              {/* The pencil says the badge is a button (as the camera does on the avatar). */}
              <span
                aria-hidden="true"
                className="absolute -right-1 -bottom-1 grid size-5 place-items-center rounded-full border border-outline-variant bg-surface-container-high text-on-surface"
              >
                <Icon name="edit" className="size-3" />
              </span>
            </button>
            <Input
              aria-label="Name"
              placeholder="Name"
              value={name}
              maxLength={100}
              autoFocus={!journal}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {pickingIcon && (
            <div role="group" aria-label="Icon" className="flex flex-wrap justify-center gap-1">
              {JOURNAL_ICONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-label={`Icon ${n.replaceAll('_', ' ')}`}
                  aria-pressed={icon === n}
                  onClick={() => setIcon(icon === n ? null : n)}
                  className={cn(
                    'state-layer grid size-9 place-items-center rounded-full',
                    icon === n ? 'bg-secondary-container' : 'text-on-surface-variant',
                  )}
                >
                  <Icon name={n} className="size-5" />
                </button>
              ))}
              <input
                aria-label="Any emoji"
                placeholder="Emoji"
                value={icon && !isJournalIconName(icon) ? icon : ''}
                onChange={(e) =>
                  setIcon(firstEmoji(e.target.value) ?? (e.target.value ? icon : null))
                }
                // Enter here would save the whole form; it only settles the emoji.
                onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
                className="h-9 w-16 rounded-full border border-input bg-transparent text-center text-sm placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
              />
              <Button variant="text" className="h-9" disabled={!icon} onClick={() => setIcon(null)}>
                <Icon name="close" className="size-5" />
                Clear
              </Button>
            </div>
          )}

          <textarea
            aria-label="Description"
            placeholder="Description (optional)"
            value={description}
            maxLength={1000}
            rows={3}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full resize-y rounded-sm border border-input bg-transparent px-4 py-3 text-base text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
          />

          <div
            role="group"
            aria-label="Color"
            className="grid grid-cols-6 justify-items-center gap-y-3"
          >
            {JOURNAL_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Color ${c}`}
                aria-pressed={color === c}
                onClick={() => setColor(c)}
                className={cn(
                  'grid size-9 place-items-center rounded-full text-white',
                  color === c && 'outline-2 outline-offset-2 outline-primary',
                )}
                style={{ background: c }}
              >
                {color === c && <Icon name="check" className="size-5" />}
              </button>
            ))}
          </div>

          {error && (
            <p role="alert" className="text-sm text-error">
              {error instanceof ApiError && error.status === 409
                ? 'This journal is archived.'
                : isUnreachable(error)
                  ? 'Couldn’t reach the server or save it on this device. Try again.'
                  : 'Something went wrong. Try again.'}
            </p>
          )}

          <DialogActions>
            <Button variant="text" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {journal ? 'Save' : 'Create'}
            </Button>
          </DialogActions>
        </form>

        {journal && (
          <div className="flex flex-col gap-1 border-t border-outline-variant pt-3">
            {me && <JournalOfflineToggle userId={me.id} journal={journal} />}
            {!journal.archivedAt && (
              <Button
                variant="text"
                className="justify-start"
                disabled={isDefault || updateMe.isPending}
                onClick={() =>
                  updateMe.mutate({ defaultJournalId: journal.id }, { onSuccess: onClose })
                }
              >
                <Icon name="check" className={cn('size-5', !isDefault && 'opacity-0')} />
                {isDefault ? 'Default for new entries' : 'Make default for new entries'}
              </Button>
            )}
            <Button
              variant="text"
              className="justify-start"
              disabled={busy}
              onClick={() => archive.mutate(!journal.archivedAt)}
            >
              <Icon name={journal.archivedAt ? 'unarchive' : 'archive'} className="size-5" />
              {journal.archivedAt ? 'Unarchive' : 'Archive'}
            </Button>
            <Button variant="text" className="justify-start" onClick={() => setExporting(true)}>
              <Icon name="download" className="size-5" />
              Export…
            </Button>
            <Button
              variant="text"
              className="justify-start text-error"
              disabled={busy}
              onClick={() => setConfirmingDelete(true)}
            >
              <Icon name="delete" className="size-5" />
              Delete…
            </Button>
            {!journal.archivedAt && (
              <p className="px-4 pt-1 text-xs text-on-surface-variant">
                Archived journals are read-only and stay out of the timeline until you unarchive
                them.
              </p>
            )}
          </div>
        )}
      </Dialog>

      <ConfirmDialog
        open={open && confirmingDiscard}
        onClose={() => setConfirmingDiscard(false)}
        title="Discard changes?"
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onConfirm={() => {
          setConfirmingDiscard(false)
          onClose()
        }}
      >
        <p className="text-on-surface-variant">
          Your edits to {journal ? 'this journal' : 'the new journal'} haven’t been saved.
        </p>
      </ConfirmDialog>

      {journal && (
        <JournalExportDialog
          journal={journal}
          open={open && exporting}
          onClose={() => setExporting(false)}
        />
      )}

      {journal && (
        <JournalDeleteDialog
          journal={journal}
          open={open && confirmingDelete}
          onClose={() => setConfirmingDelete(false)}
          onDeleted={() => {
            setConfirmingDelete(false)
            done()
          }}
        />
      )}
    </>
  )
}

/** "Keep on this device" for one journal; the whole picture is on the Offline & sync page. */
function JournalOfflineToggle({ userId, journal }: { userId: string; journal: Journal }) {
  const c = useOfflineControls(userId)
  const implied = c.isImplied(journal)
  // rev 0: made offline and not sent yet, so the server can't estimate or send it to this device.
  const unsent = journal.rev === 0
  const line = unsent
    ? 'Available once it’s saved to your account'
    : c.isKept(journal)
      ? c.describe(journal)
      : implied
        ? 'Included by “Keep all journals”'
        : c.describe(journal)
  return (
    <div className="flex items-center gap-4 px-4 py-2">
      <div className="min-w-0 flex-1">
        <p>Keep on this device</p>
        <p className="text-sm text-on-surface-variant">
          {line}
          {line ? ' · ' : ''}
          <Link to="/sync" className="underline">
            Offline &amp; sync
          </Link>
        </p>
      </div>
      <Switch
        checked={!unsent && (implied || c.isKept(journal))}
        disabled={implied || unsent}
        label={`Keep ${journal.name} on this device`}
        onChange={(on) => void c.setJournal(journal, on)}
      />
    </div>
  )
}
