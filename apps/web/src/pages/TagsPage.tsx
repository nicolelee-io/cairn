import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router'
import { MAX_TAG_LENGTH, TagChangeSchema, tagKey, type TagCount } from '@cairn/shared'
import { Icon } from '../components/Icon.tsx'
import { ListRow } from '../components/ListRow.tsx'
import { NeedsConnection } from '../components/NeedsConnection.tsx'
import { Button } from '../components/ui/button.tsx'
import { ConfirmDialog, Dialog, DialogActions } from '../components/ui/dialog.tsx'
import { Input } from '../components/ui/input.tsx'
import { api, ApiError } from '../lib/api.ts'
import { invalidateAfterTagChange, useTags } from '../lib/queries.ts'
import { autofocusWithMouse } from '../lib/pointer.ts'
import { useServerDown } from '../lib/serverStatus.ts'
import { Page } from './Page.tsx'
import { LoadingState } from '../components/Spinner.tsx'

const entries = (n: number) => `${n} ${n === 1 ? 'entry' : 'entries'}`

/** Manage tags: every tag with its entry count; tap one to rename, merge or delete it. */
export function TagsPage() {
  const tags = useTags()
  // The same signal as the nav's Offline line. Renaming, merging and deleting need the server (they
  // aren't queued), so while it is down there is nothing to edit; the list is hidden with the rest.
  const down = useServerDown()
  const [selected, setSelected] = useState<TagCount | null>(null)
  const list = tags.data?.tags ?? []

  return (
    <Page title="Manage tags" icon="sell" back>
      {down && (
        <NeedsConnection onRetry={() => void tags.refetch()}>
          Reconnect to rename, merge or delete tags.
        </NeedsConnection>
      )}
      {!down && tags.isPending && <LoadingState />}
      {!down && tags.isError && <p role="alert">Couldn’t load tags.</p>}
      {!down && tags.data && list.length === 0 && (
        <p className="rounded-lg bg-surface-container-low p-4 text-on-surface-variant">
          No tags yet. Add them to an entry from the editor.
        </p>
      )}
      {!down && (
        <ul aria-label="Tags" className="flex flex-col gap-2">
          {list.map((t) => (
            <ListRow
              key={t.name}
              as="button"
              label={`Edit ${t.name}`}
              onClick={() => setSelected(t)}
              className="rounded-lg bg-surface-container-low"
              lead={<Icon name="sell" className="size-5 shrink-0 text-on-surface-variant" />}
              title={t.name}
              end={<span className="text-sm text-on-surface-variant">{t.count}</span>}
              trailing={
                <Link
                  to={`/?tag=${encodeURIComponent(t.name)}`}
                  aria-label={`Open entries tagged ${t.name}`}
                  className="state-layer grid size-10 shrink-0 place-items-center rounded-full text-on-surface-variant"
                >
                  <Icon name="chevron_right" />
                </Link>
              }
            />
          ))}
        </ul>
      )}
      {/* Keyed so each tag opens with fresh form state. */}
      {!down && (
        <TagEditDialog
          key={selected?.name ?? 'none'}
          tag={selected}
          others={list}
          onClose={() => setSelected(null)}
        />
      )}
    </Page>
  )
}

type Step = 'edit' | 'pick' | 'merge' | 'delete'

function TagEditDialog({
  tag,
  others,
  onClose,
}: {
  tag: TagCount | null
  others: TagCount[]
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [name, setName] = useState(tag?.name ?? '')
  const [step, setStep] = useState<Step>('edit')
  // The tag chosen in the "Merge into…" picker; null when the merge comes from typing an existing name.
  const [picked, setPicked] = useState<string | null>(null)
  const done = () => {
    invalidateAfterTagChange(qc)
    onClose()
  }

  // The tag a new name would land on, if it is another one (a capital letter alone isn't).
  const target = tag
    ? others.find((t) => tagKey(t.name) === tagKey(name) && tagKey(t.name) !== tagKey(tag.name))
    : undefined
  const clean = name.trim().replace(/^#+\s*/, '')
  const into = picked ?? target?.name ?? clean
  const mergeTargets = others.filter((t) => t.name !== tag?.name)
  const unchanged = !tag || clean === tag.name

  const rename = useMutation({
    mutationFn: () =>
      api('/tags', {
        method: 'PATCH',
        body: { name: tag!.name, newName: clean },
        schema: TagChangeSchema,
      }),
    onSuccess: done,
    // Someone made that tag since the list loaded: offer the merge instead of failing.
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) setStep('merge')
    },
  })
  const merge = useMutation({
    mutationFn: () =>
      api('/tags/merge', {
        method: 'POST',
        body: { from: tag!.name, into },
        schema: TagChangeSchema,
      }),
    onSuccess: done,
  })
  const remove = useMutation({
    mutationFn: () =>
      api(`/tags?name=${encodeURIComponent(tag!.name)}`, {
        method: 'DELETE',
        schema: TagChangeSchema,
      }),
    onSuccess: done,
  })
  const busy = rename.isPending || merge.isPending || remove.isPending
  const failed = (m: { isError: boolean }) => m.isError && <Failure />

  const save = () => {
    if (!clean || unchanged || busy) return
    if (target) setStep('merge')
    else rename.mutate()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    save()
  }

  return (
    <>
      <Dialog open={!!tag && step === 'edit'} onClose={onClose} title="Edit tag">
        <Input
          aria-label="Name"
          data-autofocus={autofocusWithMouse()}
          placeholder="Name"
          value={name}
          maxLength={MAX_TAG_LENGTH}
          autoCapitalize="none"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onKey}
        />
        {target && (
          <p className="text-sm text-on-surface-variant">
            “{target.name}” already exists. Saving merges this tag into it.
          </p>
        )}
        {rename.isError && !(rename.error instanceof ApiError && rename.error.status === 409) && (
          <Failure />
        )}
        <DialogActions>
          <Button variant="text" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || !clean || unchanged} onClick={save}>
            {target ? 'Merge…' : 'Save'}
          </Button>
        </DialogActions>
        <div className="flex flex-col gap-2 border-t border-outline-variant pt-3">
          {mergeTargets.length > 0 && (
            <Button
              variant="text"
              className="justify-start"
              disabled={busy}
              onClick={() => setStep('pick')}
            >
              <Icon name="sell" className="size-5" />
              Merge into…
            </Button>
          )}
          <Button
            variant="text"
            className="justify-start text-error"
            disabled={busy}
            onClick={() => setStep('delete')}
          >
            <Icon name="delete" className="size-5" />
            Delete…
          </Button>
        </div>
      </Dialog>

      {tag && (
        <Dialog
          open={step === 'pick'}
          onClose={() => setStep('edit')}
          title={`Merge “${tag.name}” into`}
        >
          <TagPicker
            tags={mergeTargets}
            onBack={() => setStep('edit')}
            onPick={(t) => {
              setPicked(t.name)
              setStep('merge')
            }}
          />
        </Dialog>
      )}

      {tag && (
        <ConfirmDialog
          open={step === 'merge'}
          // Back (and Esc) go to wherever the merge was chosen: the picker, or the typed name.
          onClose={() => {
            setStep(picked ? 'pick' : 'edit')
            setPicked(null)
          }}
          title={`Merge “${tag.name}”?`}
          confirmLabel="Merge"
          destructive={false}
          cancelLabel="Back"
          pending={busy}
          onConfirm={() => merge.mutate()}
        >
          <p className="text-on-surface-variant">
            The {entries(tag.count)} tagged “{tag.name}” will be tagged “{into}” instead, and “
            {tag.name}” will be removed. There is no undo.
          </p>
          {failed(merge)}
        </ConfirmDialog>
      )}

      {tag && (
        <ConfirmDialog
          open={step === 'delete'}
          onClose={() => setStep('edit')}
          title={`Delete “${tag.name}”?`}
          confirmLabel="Delete"
          pending={busy}
          onConfirm={() => remove.mutate()}
        >
          <p className="text-on-surface-variant">
            This removes the tag from its {entries(tag.count)}. The entries stay. There is no undo.
          </p>
          {failed(remove)}
        </ConfirmDialog>
      )}
    </>
  )
}

/** A searchable list of the tags a tag can merge into, in its own dialog: roomy on a phone. */
function TagPicker({
  tags,
  onPick,
  onBack,
}: {
  tags: TagCount[]
  onPick: (t: TagCount) => void
  onBack: () => void
}) {
  const [query, setQuery] = useState('')
  const q = tagKey(query.replace(/^#+\s*/, ''))
  const shown = q ? tags.filter((t) => tagKey(t.name).includes(q)) : tags
  return (
    <div className="flex flex-col gap-3">
      <Input
        type="search"
        aria-label="Search tags"
        data-autofocus={autofocusWithMouse()}
        placeholder="Search tags"
        value={query}
        autoCapitalize="none"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          e.preventDefault()
          if (shown[0]) onPick(shown[0])
        }}
      />
      <ul aria-label="Merge into" className="-mx-2 -my-1 max-h-[50dvh] overflow-y-auto py-1">
        {shown.map((t) => (
          <li key={t.name}>
            <button
              type="button"
              onClick={() => onPick(t)}
              className="state-layer flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-left"
            >
              <Icon name="sell" className="size-5 shrink-0 text-on-surface-variant" />
              <span className="min-w-0 flex-1 truncate">{t.name}</span>
              <span className="shrink-0 text-sm text-on-surface-variant">{t.count}</span>
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="px-3 py-3 text-on-surface-variant">No matches</li>}
      </ul>
      <Button variant="text" className="self-end" onClick={onBack}>
        Cancel
      </Button>
    </div>
  )
}

function Failure() {
  return (
    <p role="alert" className="text-sm text-error">
      Couldn’t change the tag. Try again once you’re online.
    </p>
  )
}
