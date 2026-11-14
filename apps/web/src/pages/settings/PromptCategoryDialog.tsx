import { useState } from 'react'
import {
  CATEGORY_NAME_MAX_LENGTH,
  MAX_PROMPT_CATEGORIES,
  PROMPT_ICONS,
  DEFAULT_PROMPT_ICON,
  type PromptCategory,
  type PromptIcon,
} from '@cairn/shared'
import { Icon } from '../../components/Icon.tsx'
import { Button } from '../../components/ui/button.tsx'
import { ConfirmDialog, Dialog, DialogActions } from '../../components/ui/dialog.tsx'
import { Input } from '../../components/ui/input.tsx'
import { cn } from '../../lib/cn.ts'
import { errorCode } from '../../lib/api.ts'
import { autofocusWithMouse } from '../../lib/pointer.ts'
import { useCreateCategory, useDeleteCategory, useUpdateCategory } from '../../lib/prompts.ts'

const message = (e: unknown) =>
  errorCode(e) === 'category_exists'
    ? 'A category with that name already exists.'
    : errorCode(e) === 'limit_reached'
      ? `There can be at most ${MAX_PROMPT_CATEGORIES} categories.`
      : 'Couldn’t save the category. Try again once you’re online.'

/**
 * Add or edit a prompt category (admins): a name, an icon from the curated list, and, when editing,
 * Delete…. `category` null is a new one. Deleting never deletes prompts; they become uncategorized.
 * `promptCount` is how many suggested prompts use it, for the confirmation. Mounted only while open.
 */
export function PromptCategoryDialog({
  category,
  promptCount,
  onClose,
}: {
  category: PromptCategory | null
  promptCount: number
  onClose: () => void
}) {
  const create = useCreateCategory()
  const update = useUpdateCategory()
  const remove = useDeleteCategory()
  const [name, setName] = useState(category?.name ?? '')
  const [icon, setIcon] = useState<PromptIcon>(
    (category?.icon as PromptIcon | undefined) ?? DEFAULT_PROMPT_ICON,
  )
  const [confirming, setConfirming] = useState(false)
  const clean = name.trim()
  const unchanged = !!category && clean === category.name && icon === category.icon
  const save = category ? update : create
  const canSave = !!clean && !unchanged && !save.isPending

  const submit = () => {
    if (!canSave) return
    const done = { onSuccess: onClose }
    if (category) update.mutate({ id: category.id, name: clean, icon }, done)
    else create.mutate({ name: clean, icon }, done)
  }

  return (
    <>
      <Dialog
        open={!confirming}
        onClose={onClose}
        title={category ? 'Edit category' : 'New category'}
      >
        <Input
          aria-label="Name"
          data-autofocus={autofocusWithMouse()}
          placeholder="Name"
          value={name}
          maxLength={CATEGORY_NAME_MAX_LENGTH}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            submit()
          }}
        />
        <div role="group" aria-label="Icon" className="grid grid-cols-6 gap-1">
          {PROMPT_ICONS.map((i) => (
            <button
              key={i}
              type="button"
              aria-label={i.replaceAll('_', ' ')}
              aria-pressed={icon === i}
              onClick={() => setIcon(i)}
              className={cn(
                'state-layer grid size-11 cursor-pointer place-items-center rounded-full',
                icon === i
                  ? 'bg-primary-container text-on-primary-container'
                  : 'text-on-surface-variant',
              )}
            >
              <Icon name={i} className="size-5" />
            </button>
          ))}
        </div>
        {save.isError && (
          <p role="alert" className="text-sm text-error">
            {message(save.error)}
          </p>
        )}
        <DialogActions>
          <Button variant="text" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!canSave} onClick={submit}>
            Save
          </Button>
        </DialogActions>
        {category && (
          <div className="border-t border-outline-variant pt-3">
            <Button
              variant="text"
              className="justify-start text-error"
              onClick={() => setConfirming(true)}
            >
              <Icon name="delete" className="size-5" />
              Delete…
            </Button>
          </div>
        )}
      </Dialog>

      {category && (
        <ConfirmDialog
          open={confirming}
          onClose={() => setConfirming(false)}
          title={`Delete “${category.name}”?`}
          confirmLabel="Delete"
          cancelLabel="Back"
          pending={remove.isPending}
          error={remove.isError ? 'Couldn’t delete the category.' : undefined}
          onConfirm={() => remove.mutate(category.id, { onSuccess: onClose })}
        >
          <p className="text-on-surface-variant">
            {promptCount > 0
              ? `${promptCount} suggested ${promptCount === 1 ? 'prompt uses' : 'prompts use'} it. They stay, with no category. `
              : ''}
            Prompts people have saved keep their text and lose the category too. There is no undo.
          </p>
        </ConfirmDialog>
      )}
    </>
  )
}
