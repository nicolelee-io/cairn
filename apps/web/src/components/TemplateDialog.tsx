import { useRef, useState, type KeyboardEvent } from 'react'
import { TEMPLATE_BODY_MAX_LENGTH, TEMPLATE_NAME_MAX_LENGTH } from '@cairn/shared'
import { errorCode } from '../lib/api.ts'
import { autofocusWithMouse } from '../lib/pointer.ts'
import { PLACEHOLDERS } from '../lib/templateText.ts'
import { Button } from './ui/button.tsx'
import { Dialog, DialogActions } from './ui/dialog.tsx'
import { Input } from './ui/input.tsx'
import { Textarea } from './ui/textarea.tsx'

export interface TemplateValue {
  name: string
  bodyMd: string
}

/**
 * Add or edit a template: a name, its text and buttons that put a placeholder at the caret. The
 * caller supplies the save and what it returned as `pending` and `error`; close the dialog from its
 * `onSubmit` once it worked. `onDelete` adds a Delete… button (an edit has one, a new template not).
 * The form is mounted only while open, so each opening starts from `initial`. With `edit`, `initial`
 * is a saved template and Save stays off until something changes; without it `initial` is only a
 * starting point (an entry's text being saved as a template) and is saved as it stands.
 */
export function TemplateDialog({
  open,
  onClose,
  title,
  submitLabel = 'Save',
  initial,
  edit = false,
  onSubmit,
  onDelete,
  pending = false,
  error,
}: {
  open: boolean
  onClose: () => void
  title: string
  submitLabel?: string
  initial?: TemplateValue
  edit?: boolean
  onSubmit: (value: TemplateValue) => void
  onDelete?: () => void
  pending?: boolean
  error?: unknown
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <TemplateForm
        initial={initial}
        edit={edit}
        submitLabel={submitLabel}
        onClose={onClose}
        onSubmit={onSubmit}
        onDelete={onDelete}
        pending={pending}
        error={error}
      />
    </Dialog>
  )
}

function TemplateForm({
  initial,
  edit,
  submitLabel,
  onClose,
  onSubmit,
  onDelete,
  pending,
  error,
}: {
  initial?: TemplateValue
  edit: boolean
  submitLabel: string
  onClose: () => void
  onSubmit: (value: TemplateValue) => void
  onDelete?: () => void
  pending: boolean
  error: unknown
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [body, setBody] = useState(initial?.bodyMd ?? '')
  const bodyBox = useRef<HTMLTextAreaElement>(null)
  const cleanName = name.trim()
  const unchanged = edit && !!initial && cleanName === initial.name && body === initial.bodyMd
  const canSave = !!cleanName && !!body.trim() && !unchanged && !pending

  const save = () => {
    if (canSave) onSubmit({ name: cleanName, bodyMd: body })
  }

  // Puts the placeholder where the caret (or selection) is in the text and leaves the caret after it.
  const insert = (token: string) => {
    const box = bodyBox.current
    const from = box?.selectionStart ?? body.length
    const to = box?.selectionEnd ?? body.length
    setBody(body.slice(0, from) + token + body.slice(to))
    requestAnimationFrame(() => {
      box?.focus()
      box?.setSelectionRange(from + token.length, from + token.length)
    })
  }

  const nameKeys = (e: KeyboardEvent) => {
    // Enter moves on to the text. It never submits: this form can sit inside the entry editor's form.
    if (e.key !== 'Enter') return
    e.preventDefault()
    bodyBox.current?.focus()
  }

  return (
    <>
      <Input
        aria-label="Template name"
        data-autofocus={autofocusWithMouse()}
        placeholder="Name, e.g. Daily log"
        value={name}
        maxLength={TEMPLATE_NAME_MAX_LENGTH}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={nameKeys}
      />
      <Textarea
        ref={bodyBox}
        aria-label="Template text"
        className="min-h-56 resize-y font-entry"
        placeholder="The text that goes into an entry"
        value={body}
        maxLength={TEMPLATE_BODY_MAX_LENGTH}
        onChange={(e) => setBody(e.target.value)}
      />
      <div role="group" aria-label="Placeholders" className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-on-surface-variant">Insert</span>
        {PLACEHOLDERS.map((p) => (
          <Button
            key={p.token}
            variant="outlined"
            className="h-8 px-3 text-sm"
            onClick={() => insert(p.token)}
          >
            {p.label}
          </Button>
        ))}
      </div>
      <p className="-mt-2 text-sm text-on-surface-variant">
        A placeholder such as {'{{date}}'} is replaced with today’s date or time when you insert the
        template, on the entry’s own clock. Anything else goes in as typed.
      </p>
      {error !== undefined && error !== null && (
        <p role="alert" className="text-sm text-error">
          {errorCode(error) === 'limit_reached'
            ? 'You have reached the limit for templates.'
            : 'Couldn’t save the template. Try again once you’re online.'}
        </p>
      )}
      <DialogActions>
        {onDelete && (
          <Button variant="text" className="mr-auto text-error" onClick={onDelete}>
            Delete…
          </Button>
        )}
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
