import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import {
  attachmentMarkdown,
  attachmentRefs,
  countWords,
  moodByKey,
  photoMarkdown,
  photoRefs,
  stripPhotoRef,
  swapPhotoRefs,
  type Journal,
  type Photo,
} from '@cairn/shared'
import { useMe } from '../../auth/useAuth.ts'
import { type DraftFields } from '../../lib/draft.ts'
import { currentPosition, describePoint } from '../../lib/geolocate.ts'
import { plural } from '../../lib/format.ts'
import { useWordCount } from '../../lib/wordCount.ts'
import { bareLocation } from '../../lib/location.ts'
import { canGoBack, useGoBack } from '../../lib/navigation.ts'
import {
  bold,
  insertBlock,
  italic,
  link,
  prefixLines,
  strikethrough,
} from '../../lib/markdownEdit.ts'
import { useShortcuts } from '../../lib/shortcuts.ts'
import { shortcutHint } from '../../lib/shortcutCatalog.ts'
import { weatherAfterMove } from '../../lib/weather.ts'
import { FILE_ACCEPT, PHOTO_ACCEPT } from '../../lib/upload.ts'
import { useUploads, type Uploaded } from '../../lib/useUploads.ts'
import { useBrowseParams } from '../../lib/useBrowseParams.ts'
import { cn } from '../../lib/cn.ts'
import { useSourceMode } from '../../lib/editorMode.ts'
import { setImmersive, useImmersive } from '../../lib/immersive.ts'
import { useMediaQuery } from '../../lib/useMediaQuery.ts'
import { useKeyboardInset } from '../../lib/useKeyboardInset.ts'
import { EntryPaneHeader, FlagToggle } from '../EntryHeader.tsx'
import { Icon } from '../Icon.tsx'
import { Lightbox } from '../Lightbox.tsx'
import { Button } from '../ui/button.tsx'
import { Dialog, DialogActions } from '../ui/dialog.tsx'
import { DateTimeDialog } from './DateTimeDialog.tsx'
import { WeatherDialog } from '../WeatherDialog.tsx'
import { LocationDialog } from './LocationDialog.tsx'
import { TagDialog } from './TagDialog.tsx'
import { TemplatesButton, useTemplatesMenu } from './TemplatesButton.tsx'
import { MoodPicker } from './MoodPicker.tsx'
import { useTip } from '../../lib/useTip.tsx'
import { PhotoStrip } from './PhotoStrip.tsx'
import { MarkdownEditor, type EditorHandle } from './cm/MarkdownEditor.tsx'
import { BUILT_IN_ITEMS, type InsertItem } from '../../lib/insertItems.ts'
import { isCoarse } from '../../lib/pointer.ts'
import { templateItems } from '../../lib/templateText.ts'
import { useTemplates } from '../../lib/templates.ts'
import { EntryMetaBar } from './EntryMetaBar.tsx'
import { Toolbar } from './Toolbar.tsx'
import { useEntryDraft, type EditorSource } from './useEntryDraft.ts'
import { useSaveEntry } from './useSaveEntry.ts'

export type { EditorSource }

/**
 * The entry editor, for /new and /entry/:id/edit. Everything you type is a draft in localStorage
 * until Save (SPEC 6): nothing reaches the server, and no empty entry is ever created, before then.
 * Pass `key` so a different entry gets a fresh editor.
 */
export function EntryEditor({
  userId,
  journals,
  source,
}: {
  userId: string
  /** Active journals only: the ones an entry can be written to or moved into. */
  journals: Journal[]
  source: EditorSource
}) {
  const navigate = useNavigate()
  const goBack = useGoBack()
  const location = useLocation()
  const { base } = useBrowseParams()
  const inset = useKeyboardInset()
  // From 840px the toolbar sits at the top; on a phone it rides above the keyboard.
  const wide = useMediaQuery('(min-width: 840px)')
  const [typing, setTyping] = useState(false)
  const toolbarBox = useRef<HTMLDivElement>(null)

  const draft = useEntryDraft({ userId, journals, source })
  const {
    isNew,
    entryId,
    newId,
    baseline,
    setBaseline,
    fields,
    setFields,
    set,
    baseRev,
    restored,
    removedLoose,
    setRemovedLoose,
    dirty,
    draftSavedAt,
    latest,
  } = draft
  // Opened from the Drafts page: the draft is what you asked for, so no note about it.
  const fromDrafts = (location.state as { fromDrafts?: boolean } | null)?.fromDrafts === true
  // Opened with the reader's Edit button: the reader is the history entry just behind us.
  const fromReader = (location.state as { fromReader?: boolean } | null)?.fromReader === true
  // Arrived by a save that kept the editor open (a new entry's first Ctrl+S): keep typing.
  const keepFocus = (location.state as { keepFocus?: boolean } | null)?.keepFocus === true
  const [sourceMode, setSource] = useSourceMode()
  const immersive = useImmersive()
  const [viewing, setViewing] = useState<string | null>(null)
  // Photos uploaded in this session: not in the saved entry yet, but the lightbox needs them.
  const [uploaded, setUploaded] = useState<Photo[]>([])
  const [dateOpen, setDateOpen] = useState(false)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [moodOpen, setMoodOpen] = useState(false)
  const closeMood = useCallback(() => setMoodOpen(false), [])
  const focusText = useCallback(() => editor.current?.focus(), [])
  const mood = moodByKey(fields.mood)
  const moodTip = useTip(mood ? mood.label : 'Add mood')
  const [placeOpen, setPlaceOpen] = useState(false)
  const [weatherOpen, setWeatherOpen] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)

  // The "add location to new entries" setting: a fresh entry (not a restored draft) starts with
  // where you are. Weather follows on its own when the entry with a place is saved. A refusal or
  // failure just leaves the place empty. The place goes into the baseline too, so an entry you never
  // typed in isn't a draft worth keeping.
  const autoLocate = useMe().data?.autoLocation === true && isNew && !draft.wasRestored
  const [locating, setLocating] = useState(autoLocate)
  useEffect(() => {
    if (!autoLocate) return
    let live = true
    void (async () => {
      try {
        const pos = await currentPosition()
        const place = await describePoint(pos.coords.latitude, pos.coords.longitude).catch(() =>
          bareLocation(pos.coords.latitude, pos.coords.longitude),
        )
        if (!live) return
        // Weather follows the place: automatic, and previewed in the chip below.
        const add = <T extends DraftFields>(f: T): T =>
          f.location ? f : { ...f, location: place, weather: f.weather ?? { auto: true } }
        setBaseline(add)
        setFields(add)
      } catch {
        // Permission refused, no GPS, or insecure origin: nothing to add.
      } finally {
        if (live) setLocating(false)
      }
    })()
    return () => {
      live = false
    }
  }, [autoLocate, setBaseline, setFields])

  // A new place or time: weather nobody chose by hand follows it (see weatherAfterMove).
  const baselineSource = source.kind === 'edit' ? (source.detail.weather?.source ?? null) : null
  const setMoved = (
    patch: Partial<Pick<DraftFields, 'location' | 'createdAt' | 'timezone' | 'allDay'>>,
  ) =>
    setFields((f) => {
      const next = { ...f, ...patch }
      return {
        ...next,
        weather: weatherAfterMove(f, next, latest.current.baseline.weather, baselineSource),
      }
    })

  const editor = useRef<EditorHandle>(null)
  // What `/` offers: the user's templates first (they are the user's own), then the built-ins.
  const templates = useTemplates().data?.templates
  const slashItems = useMemo(
    () => [...templateItems(templates ?? []), ...BUILT_IN_ITEMS],
    [templates],
  )

  // ---- Photos ----
  // An upload is stored right away but belongs to no entry until Save: the text's reference to it
  // is what attaches it (and removing the reference is what deletes it), so drafts need no extra
  // state. Each one is dropped into the text at the caret when it lands.
  const photoInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const appendBlock = (md: string) =>
    setFields((f) => {
      const e = insertBlock(f.bodyMd, f.bodyMd.length, f.bodyMd.length, md)
      return { ...f, bodyMd: f.bodyMd + e.insert }
    })
  const insertMedia = (item: Uploaded) => {
    const md =
      'photo' in item
        ? photoMarkdown(item.photo.id)
        : attachmentMarkdown(item.attachment.id, item.attachment.filename)
    if ('photo' in item) setUploaded((u) => [...u, item.photo])
    const ed = editor.current
    // An editor nobody has put a caret in reports position 0, which would sit above the title.
    if (ed && ed.hasCaret()) ed.edit((v, s, e) => insertBlock(v, s, e, md))
    else appendBlock(md)
  }
  const photoUploads = useUploads(insertMedia)
  const photoIds = photoRefs(fields.bodyMd)
  const looseIds =
    source.kind === 'edit'
      ? source.detail.photos
          .map((p) => p.id)
          .filter((id) => !photoIds.includes(id) && !removedLoose.includes(id))
      : []
  // Attachments the entry has but the text doesn't mention, like loose photos.
  const fileIds = attachmentRefs(fields.bodyMd)
  const looseFiles =
    source.kind === 'edit'
      ? source.detail.attachments.filter(
          (a) => !fileIds.includes(a.id) && !removedLoose.includes(a.id),
        )
      : []
  const canSave = dirty && !photoUploads.busy && (!isNew || fields.bodyMd.trim() !== '')

  const { save, conflict, setConflict, error, setError } = useSaveEntry({
    userId,
    isNew,
    entryId,
    newId,
    target: draft.target,
    fields,
    baseline,
    baseRev,
    removedLoose,
    settle: draft.settle,
    setBaseRev: draft.setBaseRev,
    onSaved: toReader,
    onStayed: (detail, sent) => {
      if (isNew) {
        // The entry exists now, so carry on in the edit route (a PATCH from here on). It remounts
        // with the server's copy, and `keepFocus` puts the caret back in the text.
        draft.settle()
        navigate(`${base}/entry/${detail.entry.id}/edit`, {
          replace: true,
          state: { keepFocus: true },
        })
      } else draft.adoptSaved(detail, sent)
    },
  })

  // Save keeps the editor open (Ctrl+S); `close` goes on to the reader (the header button).
  const submit = (close: boolean) => {
    if (canSave && !save.isPending) {
      setError(null)
      save.mutate({ close, sent: fields })
    }
  }
  const sourceTip = useTip(
    `${sourceMode ? 'Styled text' : 'Plain markdown'} (${shortcutHint('editor.source')})`,
  )
  const immersiveTip = useTip(
    `${immersive ? 'Leave zen mode' : 'Zen mode'} (${shortcutHint('editor.immersive')})`,
  )
  const saveTip = useTip(`Save and close (${shortcutHint('editor.saveClose')})`)

  // ---- Leaving ----
  // Back to the entry in the reader. Opened from the reader, step back to it (replacing would leave
  // two copies of the entry in history, so Back would have to go through it twice).
  function toReader(id: string) {
    if (fromReader && canGoBack()) navigate(-1)
    else navigate(`${base}/entry/${id}`, { replace: true })
  }
  const leave = () => {
    if (entryId) toReader(entryId)
    else goBack()
  }
  const discard = () => {
    draft.settle()
    leave()
  }

  // ---- Keyboard ----
  // Registered with the app's shortcut registry (lib/shortcuts.ts), which listens before CodeMirror,
  // so these also beat its own keymap (Mod+I would select the syntax node). Esc leaves like Close.
  const runEdit = (build: Parameters<EditorHandle['edit']>[0]) => {
    editor.current?.edit(build)
    editor.current?.focus()
  }
  // An insert (a template, from the header menu or the palette) at the caret, on the entry's clock.
  const insertItem = (item: InsertItem) =>
    runEdit((v, s, e) => item.build(v, s, e, { now: Date.now(), timezone: fields.timezone }))
  const templatesMenu = useTemplatesMenu({ bodyMd: fields.bodyMd, insert: insertItem })
  const open = (set: (v: boolean) => void) => () => set(true)
  useShortcuts([
    { id: 'editor.save', run: () => submit(false) },
    // With nothing left to save (Ctrl+S just ran) it simply closes.
    { id: 'editor.saveClose', run: () => (dirty ? submit(true) : leave()) },
    // The mood picker and the journal list close on Esc themselves.
    {
      id: 'editor.leave',
      when: () =>
        !moodOpen &&
        !editor.current?.completionOpen() &&
        !document.querySelector('[aria-haspopup="listbox"][aria-expanded="true"]'),
      run: () => (dirty ? setLeaveOpen(true) : leave()),
    },
    { id: 'editor.bold', run: () => runEdit(bold) },
    { id: 'editor.italic', run: () => runEdit(italic) },
    { id: 'editor.strike', run: () => runEdit(strikethrough) },
    { id: 'editor.link', run: () => runEdit(link) },
    { id: 'editor.h1', run: () => runEdit((v, s, e) => prefixLines(v, s, e, '# ')) },
    { id: 'editor.h2', run: () => runEdit((v, s, e) => prefixLines(v, s, e, '## ')) },
    { id: 'editor.h3', run: () => runEdit((v, s, e) => prefixLines(v, s, e, '### ')) },
    { id: 'editor.bullets', run: () => runEdit((v, s, e) => prefixLines(v, s, e, '- ')) },
    { id: 'editor.numbers', run: () => runEdit((v, s, e) => prefixLines(v, s, e, '1. ')) },
    { id: 'editor.quote', run: () => runEdit((v, s, e) => prefixLines(v, s, e, '> ')) },
    { id: 'editor.immersive', when: () => wide, run: () => setImmersive(!immersive) },
    { id: 'editor.date', run: open(setDateOpen) },
    { id: 'editor.place', run: open(setPlaceOpen) },
    { id: 'editor.mood', run: () => setMoodOpen((o) => !o) },
    { id: 'editor.tags', run: open(setTagsOpen) },
    { id: 'editor.weather', run: open(setWeatherOpen) },
    {
      id: 'editor.journal',
      run: () => {
        // Focus first: the list is driven by the keys the button receives.
        const button = document.querySelector<HTMLButtonElement>('button[aria-label="Journal"]')
        button?.focus()
        button?.click()
      },
    },
    { id: 'editor.photos', run: () => photoInput.current?.click() },
    { id: 'editor.files', run: () => fileInput.current?.click() },
    { id: 'editor.pin', run: () => set({ pinned: !fields.pinned }) },
    { id: 'editor.star', run: () => set({ starred: !fields.starred }) },
    { id: 'editor.source', run: () => setSource(!sourceMode) },
  ])

  const showWords = useWordCount()
  const words = useMemo(
    () => (showWords ? countWords(fields.bodyMd) : 0),
    [showWords, fields.bodyMd],
  )
  const status = error
    ? null
    : save.isPending
      ? 'Saving…'
      : draftSavedAt
        ? 'Draft saved'
        : dirty
          ? 'Unsaved changes'
          : null

  return (
    <form
      className="@container mx-auto flex min-h-dvh w-full max-w-(--content-w) flex-col px-4 medium:px-8"
      onSubmit={(e) => {
        e.preventDefault()
        submit(true)
      }}
    >
      <EntryPaneHeader>
        <Button
          variant="text"
          size="icon"
          aria-label="Close"
          onClick={() => (dirty ? setLeaveOpen(true) : leave())}
        >
          <Icon name="close" />
        </Button>
        <p
          aria-live="polite"
          className="min-w-0 flex-1 truncate px-1 text-sm text-on-surface-variant"
        >
          {status}
        </p>
        <span className="relative">
          <Button
            variant="text"
            size="icon"
            aria-label={mood ? `Mood: ${mood.label}` : 'Add mood'}
            aria-expanded={moodOpen}
            data-mood-button=""
            onClick={() => setMoodOpen((open) => !open)}
            {...moodTip.bind}
          >
            {moodTip.node}
            {mood ? (
              <span aria-hidden="true" className="font-emoji text-xl">
                {mood.emoji}
              </span>
            ) : (
              <Icon name="add_reaction" />
            )}
          </Button>
          {moodOpen && (
            <MoodPicker
              value={fields.mood}
              onChange={(next) => {
                set({ mood: next })
                closeMood()
              }}
              onClose={closeMood}
              onDone={focusText}
            />
          )}
        </span>
        <FlagToggle
          kind="pin"
          on={fields.pinned}
          shortcut={shortcutHint('editor.pin')}
          onToggle={() => set({ pinned: !fields.pinned })}
        />
        <FlagToggle
          kind="star"
          on={fields.starred}
          shortcut={shortcutHint('editor.star')}
          onToggle={() => set({ starred: !fields.starred })}
        />
        {/* With a mouse the header has room; a touch screen has it in the toolbar. */}
        {!isCoarse() && <TemplatesButton menu={templatesMenu.menu} />}
        <Button
          variant={sourceMode ? 'tonal' : 'text'}
          size="icon"
          aria-label="Source"
          aria-pressed={sourceMode}
          onClick={() => setSource(!sourceMode)}
          {...sourceTip.bind}
        >
          {sourceTip.node}
          <Icon name="code" />
        </Button>
        {wide && (
          <Button
            variant={immersive ? 'tonal' : 'text'}
            size="icon"
            aria-label="Zen mode"
            aria-pressed={immersive}
            onClick={() => setImmersive(!immersive)}
            {...immersiveTip.bind}
          >
            {immersiveTip.node}
            <Icon name={immersive ? 'fullscreen_exit' : 'fullscreen'} />
          </Button>
        )}
        <Button
          type="submit"
          size="icon"
          aria-label="Save and close"
          disabled={!canSave || save.isPending}
          {...saveTip.bind}
        >
          {saveTip.node}
          <Icon name="check" />
        </Button>
      </EntryPaneHeader>
      {templatesMenu.dialog}

      {restored && !fromDrafts && (
        <p
          role="status"
          className="mb-3 flex flex-wrap items-center gap-x-3 rounded-lg bg-secondary-container px-4 py-2 text-sm text-on-secondary-container"
        >
          Restored your unsaved draft.
          <button type="button" className="font-medium underline" onClick={draft.resetToBaseline}>
            Discard draft
          </button>
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mb-3 rounded-lg bg-error-container px-4 py-2 text-sm text-on-error-container"
        >
          {error}
        </p>
      )}

      {wide && (
        <div className="sticky top-14 z-10 -mx-4 bg-background px-2 pb-1 medium:-mx-8 medium:px-6">
          <Toolbar
            target={editor}
            onAddPhotos={() => photoInput.current?.click()}
            onAddFiles={() => fileInput.current?.click()}
            onCamera={() => cameraInput.current?.click()}
            templates={templatesMenu.menu}
          />
        </div>
      )}

      {(
        [
          [photoInput, PHOTO_ACCEPT, 'Choose photos'],
          [fileInput, FILE_ACCEPT, 'Choose files'],
          [cameraInput, PHOTO_ACCEPT, 'Take a photo'],
        ] as const
      ).map(([ref, accept, label]) => (
        <input
          key={label}
          ref={ref}
          type="file"
          accept={accept}
          aria-label={label}
          // The camera takes one shot at a time; `capture` opens it straight away on a phone.
          capture={ref === cameraInput ? 'environment' : undefined}
          multiple={ref !== cameraInput}
          hidden
          onChange={(e) => {
            photoUploads.add([...(e.target.files ?? [])])
            e.target.value = '' // picking the same file again should still fire
          }}
        />
      ))}

      <div className="flex flex-1 flex-col">
        <MarkdownEditor
          handle={editor}
          value={fields.bodyMd}
          onChange={(bodyMd) => set({ bodyMd })}
          placeholder="Start writing. A short first line, or a # heading, becomes the title."
          // New entries open straight into writing; an edit waits for a tap so the keyboard
          // doesn't cover the text being read.
          autoFocus={isNew || keepFocus}
          caretAtEnd={source.kind === 'new' && !!source.prompt}
          // The phone toolbar covers the bottom of the screen.
          bottomMargin={wide ? 160 : 64}
          source={sourceMode}
          onOpenPhoto={setViewing}
          onFiles={photoUploads.add}
          onFocusChange={setTyping}
          slash={{ items: slashItems, timezone: fields.timezone }}
        />
      </div>

      <PhotoStrip
        // Styled, the photos are in the text itself; the strip only shows them beside raw markdown.
        ids={sourceMode ? photoIds : []}
        looseIds={looseIds}
        onAddLoose={(id) => appendBlock(photoMarkdown(id))}
        looseFiles={looseFiles}
        onAddLooseFile={(a) => appendBlock(attachmentMarkdown(a.id, a.filename))}
        onRemoveLoose={(id) => setRemovedLoose((r) => [...r, id])}
        uploads={photoUploads.uploads}
        onRemove={(id) => set({ bodyMd: stripPhotoRef(fields.bodyMd, id) })}
        onMove={(id, dir) => {
          const other = photoIds[photoIds.indexOf(id) + dir]
          if (other) set({ bodyMd: swapPhotoRefs(fields.bodyMd, id, other) })
        }}
        onDismiss={photoUploads.dismiss}
      />

      {showWords && (
        <p className="pb-1 text-right text-sm tabular-nums text-on-surface-variant">
          {plural(words, 'word', 'words')}
        </p>
      )}
      <EntryMetaBar
        fields={fields}
        journals={journals}
        locating={locating}
        onJournal={(journalId) => set({ journalId })}
        onDone={focusText}
        onDate={() => setDateOpen(true)}
        onPlace={() => setPlaceOpen(true)}
        onWeather={() => setWeatherOpen(true)}
        onTags={() => setTagsOpen(true)}
      />

      {!wide && (
        <div
          ref={toolbarBox}
          className={cn(
            'sticky z-20 -mx-4 border-t border-outline-variant bg-surface-container px-2 pt-1 medium:-mx-8 medium:px-6',
          )}
          style={{
            bottom: inset,
            // The home-indicator space only matters with the keyboard closed.
            paddingBottom: inset || typing ? 4 : 'max(env(safe-area-inset-bottom), 4px)',
          }}
        >
          <Toolbar
            target={editor}
            onAddPhotos={() => photoInput.current?.click()}
            onAddFiles={() => fileInput.current?.click()}
            onCamera={() => cameraInput.current?.click()}
            templates={templatesMenu.menu}
          />
        </div>
      )}

      <Lightbox
        photos={photoIds.flatMap((id) => {
          const p = [...(source.kind === 'edit' ? source.detail.photos : []), ...uploaded].find(
            (x) => x.id === id,
          )
          return p ? [p] : []
        })}
        openId={viewing}
        onClose={() => setViewing(null)}
        onChange={setViewing}
      />

      <DateTimeDialog
        open={dateOpen}
        value={fields}
        onClose={() => setDateOpen(false)}
        onApply={(w) => {
          setMoved(w)
          setDateOpen(false)
        }}
      />

      <LocationDialog
        open={placeOpen}
        value={fields.location}
        photos={[...(source.kind === 'edit' ? source.detail.photos : []), ...uploaded].filter(
          (p) => photoIds.includes(p.id) || looseIds.includes(p.id),
        )}
        onClose={() => setPlaceOpen(false)}
        onApply={(location) => {
          setMoved({ location })
          setPlaceOpen(false)
        }}
      />

      <TagDialog
        open={tagsOpen}
        value={fields.tags}
        onClose={() => setTagsOpen(false)}
        onApply={(tags) => {
          set({ tags })
          setTagsOpen(false)
        }}
      />
      <WeatherDialog
        open={weatherOpen}
        value={fields.weather}
        onClose={() => setWeatherOpen(false)}
        onApply={(weather) => {
          set({ weather })
          setWeatherOpen(false)
        }}
      />

      <Dialog open={leaveOpen} onClose={() => setLeaveOpen(false)} title="Leave the editor?">
        <p className="text-on-surface-variant">
          Your changes are saved as a draft on this device. You can pick them up again later.
        </p>
        {/* Three choices don't fit side by side on a phone. */}
        <DialogActions stacked>
          <Button onClick={leave} data-autofocus="">
            Keep draft
          </Button>
          <Button variant="text" onClick={discard}>
            Discard
          </Button>
          <Button variant="text" onClick={() => setLeaveOpen(false)}>
            Keep editing
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!conflict} onClose={() => setConflict(null)} title="Edited somewhere else">
        <p className="text-on-surface-variant">
          This entry changed after you started editing. Here is what it says now:
        </p>
        <pre className="max-h-48 overflow-auto rounded-sm bg-surface-container-low p-3 font-entry text-sm whitespace-pre-wrap">
          {conflict?.entry.bodyMd.slice(0, 1500) || '(no text)'}
        </pre>
        <DialogActions>
          <Button
            variant="text"
            onClick={() => {
              if (!conflict) return
              draft.adoptTheirs(conflict)
              setConflict(null)
            }}
          >
            Use the other version
          </Button>
          {/* baseRev was already moved forward, so the next Save replaces it knowingly. */}
          <Button onClick={() => setConflict(null)}>Keep my version</Button>
        </DialogActions>
      </Dialog>
    </form>
  )
}
