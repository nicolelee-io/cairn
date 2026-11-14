import { useState } from 'react'
import type { PromptCategory, SuggestedPrompt } from '@cairn/shared'
import { plural } from '../lib/format.ts'
import { categoryById } from '../lib/prompts.ts'
import { showToast } from '../lib/toast.ts'
import { FilterChips } from './FilterChips.tsx'
import { Icon } from './Icon.tsx'
import { PromptRow } from './PromptRow.tsx'
import { Button } from './ui/button.tsx'
import { ConfirmDialog } from './ui/dialog.tsx'
import { Input } from './ui/input.tsx'

/** Rows drawn at a time: a list may run to hundreds (up to 2000). */
const PAGE = 100

const searchKey = (s: string) => s.trim().toLowerCase()

/**
 * A searchable, filterable, paged list of prompts: a search box, a chip per category in use, the
 * rows (`PromptRow`), and Show more. Your prompts (with `linkTo`) and the admin's suggested ones
 * share it; the page owns the edit and delete dialogs.
 *
 * With `bulkDelete` there is a Select button: rows become toggles, a bar offers "Select all N" (every
 * prompt matching the search and filter, not just the 100 drawn) and Delete…, which confirms. Only
 * selected prompts that are still shown are deleted, so changing the filter can't delete unseen ones.
 */
export function PromptBrowser<P extends SuggestedPrompt>({
  prompts,
  categories,
  linkTo,
  onEdit,
  onDelete,
  bulkDelete,
}: {
  prompts: P[]
  categories: PromptCategory[] | undefined
  /** Makes a row a link (write about it); without it rows are plain text. */
  linkTo?: (text: string) => string
  onEdit: (p: P) => void
  onDelete: (p: P) => void
  bulkDelete?: {
    /** Deletes these ids; resolves to how many went. */
    run: (ids: string[]) => Promise<number>
    /** Extra reassurance for the confirmation (copies people saved stay, say). */
    note?: string
  }
}) {
  const [filter, setFilter] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)

  // Only categories the prompts actually use get a chip; one that has since emptied clears the filter.
  const used = (categories ?? []).filter((c) => prompts.some((p) => p.categoryId === c.id))
  const active = used.some((c) => c.id === filter) ? filter : null
  const q = searchKey(query)
  const shown = prompts.filter(
    (p) => (!active || p.categoryId === active) && (!q || searchKey(p.text).includes(q)),
  )
  // What a delete would remove: selected and on screen (in the filter), never selected-and-hidden.
  const picked = shown.filter((p) => selected.has(p.id))
  const allPicked = shown.length > 0 && picked.length === shown.length

  const stopSelecting = () => {
    setSelecting(false)
    setSelected(new Set())
  }
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const remove = async () => {
    if (!bulkDelete) return
    setPending(true)
    setFailed(false)
    try {
      const n = await bulkDelete.run(picked.map((p) => p.id))
      setConfirming(false)
      stopSelecting()
      showToast(`Deleted ${plural(n, 'prompt', 'prompts')}`)
    } catch {
      setFailed(true)
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <Input
          type="search"
          aria-label="Search prompts"
          placeholder="Search prompts"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setLimit(PAGE)
          }}
        />
        {bulkDelete && !selecting && (
          <Button
            variant="tonal"
            size="icon"
            aria-label="Select prompts"
            title="Select prompts"
            onClick={() => setSelecting(true)}
          >
            <Icon name="checklist" />
          </Button>
        )}
      </div>
      {used.length > 0 && (
        <FilterChips
          label="Category"
          options={used}
          value={active}
          onChange={(id) => {
            setFilter(id)
            setLimit(PAGE)
          }}
        />
      )}

      {selecting && (
        <div
          role="toolbar"
          aria-label="Selection"
          className="sticky top-14 z-10 flex flex-wrap items-center gap-2 rounded-lg bg-surface-container-high px-4 py-2"
        >
          <p role="status" className="mr-auto text-sm">
            {picked.length} of {shown.length} selected
          </p>
          <Button
            variant="text"
            size="sm"
            disabled={shown.length === 0}
            onClick={() => setSelected(allPicked ? new Set() : new Set(shown.map((p) => p.id)))}
          >
            {allPicked ? 'Clear' : `Select all ${shown.length}`}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={picked.length === 0}
            onClick={() => {
              setFailed(false)
              setConfirming(true)
            }}
          >
            <Icon name="delete" className="size-4" />
            Delete…
          </Button>
          <Button variant="text" size="sm" onClick={stopSelecting}>
            Done
          </Button>
        </div>
      )}

      <ul aria-label="Prompts" className="flex flex-col gap-2">
        {shown.slice(0, limit).map((p) => (
          <PromptRow
            key={p.id}
            text={p.text}
            category={categoryById(categories, p.categoryId)}
            to={linkTo?.(p.text)}
            selection={
              selecting ? { selected: selected.has(p.id), onToggle: () => toggle(p.id) } : undefined
            }
            onEdit={() => onEdit(p)}
            onDelete={() => onDelete(p)}
          />
        ))}
      </ul>
      {shown.length === 0 && (
        <p className="rounded-lg bg-surface-container-low p-4 text-on-surface-variant">
          No prompts match.
        </p>
      )}
      {shown.length > limit && (
        <Button variant="tonal" className="self-center" onClick={() => setLimit(limit + PAGE)}>
          Show more
        </Button>
      )}

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Delete ${plural(picked.length, 'prompt', 'prompts')}?`}
        confirmLabel={`Delete ${picked.length}`}
        pending={pending}
        error={failed ? 'Couldn’t delete. Try again once you’re online.' : undefined}
        onConfirm={() => void remove()}
      >
        <ul className="flex flex-col gap-1 font-entry text-on-surface-variant">
          {picked.slice(0, 3).map((p) => (
            <li key={p.id} className="line-clamp-2">
              {p.text}
            </li>
          ))}
        </ul>
        {picked.length > 3 && (
          <p className="text-on-surface-variant">and {picked.length - 3} more.</p>
        )}
        <p className="text-sm text-on-surface-variant">
          {bulkDelete?.note ? `${bulkDelete.note} ` : ''}There is no undo.
        </p>
      </ConfirmDialog>
    </>
  )
}
