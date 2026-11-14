import { useState } from 'react'
import { PROMPT_MAX_LENGTH } from '@cairn/shared'
import { errorCode } from '../lib/api.ts'
import { autofocusWithMouse } from '../lib/pointer.ts'
import { usePromptCategories } from '../lib/prompts.ts'
import { FilterChips } from './FilterChips.tsx'
import { Button } from './ui/button.tsx'
import { Dialog, DialogActions } from './ui/dialog.tsx'
import { Textarea } from './ui/textarea.tsx'

const NONE = ''

/**
 * Add or edit a prompt: its text and an optional category. The caller supplies the save (a user's
 * own prompt now, the admin's suggested ones later) and what it returned as `pending` and `error`;
 * close the dialog from its `onSubmit` once it worked. The form is mounted only while open, so each
 * opening starts from `initial`.
 */
export function PromptDialog({
  open,
  onClose,
  title,
  submitLabel = 'Save',
  initial,
  onSubmit,
  pending = false,
  error,
}: {
  open: boolean
  onClose: () => void
  title: string
  submitLabel?: string
  initial?: { text: string; categoryId: string | null }
  onSubmit: (value: { text: string; categoryId: string | null }) => void
  pending?: boolean
  error?: unknown
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <PromptForm
        initial={initial}
        submitLabel={submitLabel}
        onClose={onClose}
        onSubmit={onSubmit}
        pending={pending}
        error={error}
      />
    </Dialog>
  )
}

function PromptForm({
  initial,
  submitLabel,
  onClose,
  onSubmit,
  pending,
  error,
}: {
  initial?: { text: string; categoryId: string | null }
  submitLabel: string
  onClose: () => void
  onSubmit: (value: { text: string; categoryId: string | null }) => void
  pending: boolean
  error: unknown
}) {
  const categories = usePromptCategories().data?.categories ?? []
  const [text, setText] = useState(initial?.text ?? '')
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? NONE)
  const clean = text.trim()
  // A category an admin deleted since the prompt was loaded is simply "none".
  const category = categories.some((c) => c.id === categoryId) ? categoryId : NONE
  const unchanged =
    !!initial && clean === initial.text && (category || null) === (initial.categoryId ?? null)
  const canSave = !!clean && !unchanged && !pending

  const save = () => {
    if (canSave) onSubmit({ text: clean, categoryId: category || null })
  }

  return (
    <>
      <Textarea
        aria-label="Prompt"
        data-autofocus={autofocusWithMouse()}
        placeholder="What would you like to write about?"
        value={text}
        maxLength={PROMPT_MAX_LENGTH}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Enter saves (a prompt is one question); Shift+Enter is not a new line either.
          if (e.key !== 'Enter') return
          e.preventDefault()
          save()
        }}
      />
      <p className="-mt-2 text-right text-xs text-on-surface-variant">
        {text.length}/{PROMPT_MAX_LENGTH}
      </p>
      {categories.length > 0 && (
        // Chips, not a dropdown: a Select's list is clipped by the dialog's edges.
        <FilterChips
          label="Category"
          allLabel="No category"
          options={categories}
          value={category || null}
          onChange={(id) => setCategoryId(id ?? NONE)}
        />
      )}
      {error !== undefined && error !== null && (
        <p role="alert" className="text-sm text-error">
          {errorCode(error) === 'limit_reached'
            ? 'You have reached the limit for prompts.'
            : 'Couldn’t save the prompt. Try again once you’re online.'}
        </p>
      )}
      <DialogActions>
        <Button variant="text" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!canSave} onClick={save}>
          {submitLabel}
        </Button>
      </DialogActions>
    </>
  )
}
