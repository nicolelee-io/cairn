import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ConflictSchema, type EntryDetail } from '@cairn/shared'
import { ApiError, errorCode } from '../../lib/api.ts'
import { type DraftFields } from '../../lib/draft.ts'
import { sameLocation } from '../../lib/location.ts'
import { sendOrQueue, withPendingEdits } from '../../lib/outbox.ts'
import { invalidateAfterSave, keys } from '../../lib/queries.ts'
import { sameTags } from '../../lib/tags.ts'
import { sameWeather } from '../../lib/weather.ts'

/**
 * The editor's Save: a POST for a new entry, a PATCH of only the changed fields (plus `baseRev`)
 * for an edit. If the server can't be reached the request is parked in the outbox instead
 * (lib/outbox.ts). A 409 becomes `conflict` (and `baseRev` is rebased so the next Save is a
 * deliberate choice); other failures become `error`. The caller decides whether Save is allowed
 * (`canSave`) and where to go afterwards: `onSaved` after a save that closes, `onStayed` after
 * one that keeps the editor open (a save that was parked in the outbox always closes: there is no
 * server copy to carry on from).
 */
export function useSaveEntry({
  userId,
  isNew,
  entryId,
  newId,
  target,
  fields,
  baseline,
  baseRev,
  removedLoose,
  settle,
  setBaseRev,
  onSaved,
  onStayed,
}: {
  userId: string
  isNew: boolean
  entryId: string | null
  newId: string
  /** The draft's slot, which the outbox clears when the queued save lands. */
  target: string
  fields: DraftFields
  baseline: DraftFields
  baseRev: number | null
  removedLoose: string[]
  /** The draft is deliberately gone (see `useEntryDraft`). */
  settle: () => void
  setBaseRev: (rev: number) => void
  /** Open the saved (or queued) entry in the reader. */
  onSaved: (id: string) => void
  /** The server's copy after a save that keeps the editor open, and the fields that were sent. */
  onStayed: (detail: EntryDetail, sent: DraftFields) => void
}) {
  const qc = useQueryClient()
  const [conflict, setConflict] = useState<EntryDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Sends the save; if the server can't be reached it is parked in the outbox instead and this
  // resolves to null. Anything the server answers is still an error.
  const send = (
    method: 'POST' | 'PATCH',
    path: string,
    id: string,
    body: Record<string, unknown>,
  ): Promise<EntryDetail | null> =>
    sendOrQueue(userId, {
      method,
      path,
      body,
      entryId: id,
      target,
      draft: { ...fields, newId: isNew ? newId : null, baseRev },
    })

  // The variables: whether to close afterwards, and `sent`, a snapshot of the fields at the click
  // (to tell whether more was typed while the request was out).
  const save = useMutation<EntryDetail | null, Error, { close: boolean; sent: DraftFields }>({
    mutationFn: (): Promise<EntryDetail | null> => {
      if (isNew) {
        const {
          journalId,
          bodyMd,
          createdAt,
          timezone,
          starred,
          pinned,
          allDay,
          mood,
          location,
          weather,
          tags,
        } = fields
        return send('POST', '/entries', newId, {
          id: newId,
          journalId,
          bodyMd,
          createdAt,
          timezone,
          starred,
          pinned,
          allDay,
          mood,
          location,
          // `auto` means "look it up", which a new entry with a place does anyway.
          // null says "no weather" (so none is fetched); `auto` is what a new entry does anyway.
          weather: weather === null ? null : 'auto' in weather ? undefined : weather,
          tags: tags.length ? tags : undefined,
        })
      }
      // Only what changed, so an edit made elsewhere to another field is not overwritten.
      const changed = Object.fromEntries(
        (Object.keys(fields) as (keyof DraftFields)[])
          .filter((k) =>
            k === 'location'
              ? !sameLocation(fields.location, baseline.location)
              : k === 'weather'
                ? !sameWeather(fields.weather, baseline.weather)
                : k === 'tags'
                  ? !sameTags(fields.tags, baseline.tags)
                  : fields[k] !== baseline[k],
          )
          .map((k) => [k, fields[k]]),
      )
      return send('PATCH', `/entries/${entryId}`, entryId ?? newId, {
        ...changed,
        baseRev: baseRev ?? undefined,
        removeMediaIds: removedLoose.length ? removedLoose : undefined,
      })
    },
    onSuccess: async (detail, { close, sent }) => {
      if (detail && !close) {
        qc.setQueryData(keys.entry(detail.entry.id), detail)
        invalidateAfterSave(qc)
        onStayed(detail, sent)
        return
      }
      settle()
      if (!detail) {
        // Waiting in the outbox: the text now lives there, and the entry shows it meanwhile.
        if (entryId) {
          const cached = qc.getQueryData<EntryDetail>(keys.entry(entryId))
          if (cached) qc.setQueryData(keys.entry(entryId), await withPendingEdits(userId, cached))
        }
        // The list shows it too (lib/outbox.ts `withPendingCards`), and a new entry opens from there.
        void qc.invalidateQueries({ queryKey: keys.entries })
        onSaved(entryId ?? newId)
        return
      }
      qc.setQueryData(keys.entry(detail.entry.id), detail)
      invalidateAfterSave(qc)
      onSaved(detail.entry.id)
    },
    onError: (e) => {
      const c = e instanceof ApiError ? ConflictSchema.safeParse(e.body) : null
      if (c?.success) {
        // Edited elsewhere since this edit began. Rebase so the next Save is deliberate, and show
        // what is there now; nothing is overwritten until the user chooses.
        setBaseRev(c.data.current.entry.rev)
        setConflict(c.data.current)
        return
      }
      const code = errorCode(e)
      setError(
        code === 'journal_archived'
          ? 'That journal is archived, so it can’t take changes. Pick another journal.'
          : code === 'journal_not_found'
            ? 'That journal no longer exists. Pick another one.'
            : 'Couldn’t save. Your text is kept as a draft; try again.',
      )
    },
  })

  return { save, conflict, setConflict, error, setError }
}
