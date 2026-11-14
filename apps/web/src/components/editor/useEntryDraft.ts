import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { uuidv7, type EntryDetail, type Journal } from '@cairn/shared'
import { clearDraft, loadDraft, saveDraft, sameFields, type DraftFields } from '../../lib/draft.ts'
import { browserTimezone } from '../../lib/entryTime.ts'
import { promptHeading } from '../../lib/prompts.ts'
import { showToast } from '../../lib/toast.ts'

export type EditorSource =
  | {
      kind: 'new'
      journalId: string
      /** Resume the new-entry draft kept under this id (its slot and the entry's id). */
      draftId?: string
      /** Start from this prompt's heading (the baseline, so an untouched entry isn't a draft). */
      prompt?: string
    }
  | { kind: 'edit'; detail: EntryDetail }

const DRAFT_DELAY_MS = 800

export const fieldsOf = (d: EntryDetail): DraftFields => ({
  journalId: d.entry.journalId,
  bodyMd: d.entry.bodyMd,
  createdAt: d.entry.createdAt,
  timezone: d.entry.timezone,
  allDay: d.entry.allDay,
  starred: d.entry.starred,
  pinned: d.entry.pinned,
  mood: d.entry.mood,
  location: d.location,
  // What it says now; an edit only goes to the server if it differs from this.
  weather: d.weather && {
    condition: d.weather.condition,
    tempC: d.weather.tempC,
    isDay: d.weather.isDay,
  },
  tags: d.tags,
})

/**
 * The editor's working copy of an entry and its localStorage draft: the fields being edited, the
 * baseline they are compared with, the revision the edit began from, and the debounced autosave
 * (flushed on pagehide, visibility change and unmount). Nothing here talks to the server; the
 * save is `useSaveEntry`.
 */
export function useEntryDraft({
  userId,
  journals,
  source,
}: {
  userId: string
  /** Active journals only: a restored draft pointing elsewhere falls back to the baseline's journal. */
  journals: Journal[]
  source: EditorSource
}) {
  const isNew = source.kind === 'new'
  const entryId = source.kind === 'edit' ? source.detail.entry.id : null
  // A draft's slot is the id of its entry. A new entry mints its id up front, so any number of
  // new-entry drafts can exist side by side. (Older drafts live in the slot 'new'.)
  const [newSlot] = useState(() => (source.kind === 'new' ? (source.draftId ?? uuidv7()) : null))
  const target = entryId ?? newSlot!

  // First render only: start from the entry (or a blank one), then lay a saved draft over it.
  const [init] = useState(() => {
    const baseline: DraftFields =
      source.kind === 'edit'
        ? fieldsOf(source.detail)
        : {
            journalId: source.journalId,
            bodyMd: source.prompt ? promptHeading(source.prompt) : '',
            createdAt: Date.now(),
            timezone: browserTimezone(),
            allDay: false,
            starred: false,
            pinned: false,
            mood: null,
            location: null,
            weather: null,
            tags: [],
          }
    const draft = loadDraft(userId, target)
    const usable = draft && !sameFields(draft, baseline)
    // A draft pointing at a journal that is since archived or deleted falls back to the baseline's.
    const fields: DraftFields = usable
      ? {
          ...draft,
          journalId: journals.some((j) => j.id === draft.journalId)
            ? draft.journalId
            : baseline.journalId,
        }
      : baseline
    return {
      baseline,
      fields,
      restored: usable ? draft.savedAt : null,
      newId: (usable && draft.newId) || newSlot || uuidv7(),
      baseRev:
        usable && draft.baseRev !== null
          ? draft.baseRev
          : source.kind === 'edit'
            ? source.detail.entry.rev
            : null,
    }
  })

  // Photos the entry has but its text never mentions: shown in the strip, deleted on Save if removed.
  const [removedLoose, setRemovedLoose] = useState<string[]>([])
  const [baseline, setBaseline] = useState(init.baseline)
  const [fields, setFields] = useState(init.fields)
  const [baseRev, setBaseRev] = useState(init.baseRev)
  const [restored, setRestored] = useState(init.restored)
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null)
  const newId = init.newId

  const set = (patch: Partial<DraftFields>) => setFields((f) => ({ ...f, ...patch }))
  const dirty = !sameFields(fields, baseline) || removedLoose.length > 0

  // ---- Autosave ----
  const latest = useRef({ fields, baseline, baseRev })
  useLayoutEffect(() => {
    latest.current = { fields, baseline, baseRev }
  })
  // Set once the draft is deliberately gone (saved or discarded) so a late flush can't resurrect it.
  const settled = useRef(false)

  const persist = useCallback(
    (quiet: boolean) => {
      if (settled.current) return false
      const { fields: f, baseline: b, baseRev: rev } = latest.current
      if (sameFields(f, b)) {
        clearDraft(userId, target)
        return false
      }
      const ok = saveDraft(userId, target, { ...f, newId: isNew ? newId : null, baseRev: rev })
      if (ok && !quiet) setDraftSavedAt(Date.now())
      return ok // whether a draft is now kept
    },
    [userId, target, isNew, newId],
  )

  useEffect(() => {
    const t = setTimeout(() => persist(false), DRAFT_DELAY_MS)
    return () => clearTimeout(t)
  }, [fields, persist])

  // Leaving with unsent changes says so, with a way to find them again.
  const persistNow = useRef(persist)
  useLayoutEffect(() => {
    persistNow.current = persist
  })
  useEffect(
    () => () => {
      if (persistNow.current(true))
        showToast('Draft saved', { label: 'View drafts', to: '/drafts' })
    },
    [],
  )

  useEffect(() => {
    const flush = () => persist(true)
    const onHide = () => document.visibilityState === 'hidden' && flush()
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onHide)
      flush() // leaving the editor by any route keeps what was typed
    }
  }, [persist])

  /** The draft is deliberately gone (saved or discarded): drop it and stop any late flush. */
  const settle = () => {
    settled.current = true
    clearDraft(userId, target)
  }

  const resetToBaseline = () => {
    setFields(baseline)
    setRemovedLoose([])
    setBaseRev(source.kind === 'edit' ? source.detail.entry.rev : null)
    setRestored(null)
    clearDraft(userId, target)
  }

  /** Conflict, "Use theirs": the server's version becomes both the baseline and the text. */
  const adoptTheirs = (detail: EntryDetail) => {
    const theirs = fieldsOf(detail)
    setBaseline(theirs)
    setFields(theirs)
    setRemovedLoose([])
    setBaseRev(detail.entry.rev)
    setRestored(null)
    clearDraft(userId, target)
  }

  /**
   * A save that keeps the editor open: the server's copy becomes the baseline and the draft is
   * dropped, but the draft stays live (not `settle`d) for what is typed next. If nothing was typed
   * since the save began, the fields take the server's copy too (it may have looked up the weather).
   */
  const adoptSaved = (detail: EntryDetail, sent: DraftFields) => {
    const saved = fieldsOf(detail)
    setBaseline(saved)
    setBaseRev(detail.entry.rev)
    setRemovedLoose([])
    setRestored(null)
    clearDraft(userId, target)
    if (sameFields(latest.current.fields, sent)) setFields(saved)
  }

  return {
    isNew,
    entryId,
    target,
    newId,
    baseline,
    setBaseline,
    fields,
    setFields,
    set,
    baseRev,
    setBaseRev,
    restored,
    removedLoose,
    setRemovedLoose,
    dirty,
    draftSavedAt,
    /** The latest fields, baseline and revision, readable from callbacks without a stale closure. */
    latest,
    /** True when a draft was restored on open (not a fresh entry). */
    wasRestored: init.restored !== null,
    settle,
    resetToBaseline,
    adoptTheirs,
    adoptSaved,
  }
}
