import type { MouseEvent } from 'react'
import type { PromptCategory } from '@cairn/shared'
import { cn } from '../lib/cn.ts'
import { openMenuFrom, useMenuTrigger, type MenuAction } from '../lib/contextMenu.ts'
import { CategoryChip } from './CategoryChip.tsx'
import { Icon } from './Icon.tsx'
import { ListRow } from './ListRow.tsx'
import { Button } from './ui/button.tsx'

/**
 * A prompt in a list: its text, its category, and a ⋮ (also right-click and long-press) with Edit
 * and Delete…. With `to` the whole row is a link that writes about it (your own prompts); without,
 * it is plain text (the admin's suggested prompts). With `selection` the row is a checkbox-like
 * toggle instead (choosing prompts to delete in bulk) and has no menu.
 */
export function PromptRow({
  text,
  category,
  to,
  selection,
  onEdit,
  onDelete,
}: {
  text: string
  category: PromptCategory | undefined
  to?: string
  selection?: { selected: boolean; onToggle: () => void }
  onEdit: () => void
  onDelete: () => void
}) {
  const build = (): MenuAction[] =>
    selection
      ? []
      : [
          { id: 'edit', label: 'Edit', icon: 'edit', run: onEdit },
          { id: 'delete', label: 'Delete…', icon: 'delete', destructive: true, run: onDelete },
        ]
  const trigger = useMenuTrigger(build, 'Prompt')
  const openMenu = (e: MouseEvent<HTMLElement>) => openMenuFrom(e.currentTarget, build, 'Prompt')
  const shared = {
    className: cn(
      'rounded-lg',
      selection?.selected
        ? 'bg-secondary-container text-on-secondary-container'
        : 'bg-surface-container-low',
    ),
    liProps: selection ? undefined : trigger,
    title: <span className="line-clamp-3 font-entry whitespace-normal">{text}</span>,
    lines: category ? [<CategoryChip key="c" category={category} />] : undefined,
  }

  if (selection)
    return (
      <ListRow
        as="button"
        pressed={selection.selected}
        label={text}
        onClick={selection.onToggle}
        lead={
          <Icon
            name={selection.selected ? 'check_circle' : 'radio_button_unchecked'}
            filled={selection.selected}
            className="shrink-0"
          />
        }
        {...shared}
      />
    )

  const trailing = (
    <Button
      variant="text"
      size="icon"
      aria-label="More actions"
      aria-haspopup="menu"
      onClick={openMenu}
    >
      <Icon name="more_vert" />
    </Button>
  )
  return to ? (
    <ListRow as="link" to={to} label={`Write about: ${text}`} trailing={trailing} {...shared} />
  ) : (
    <ListRow as="static" trailing={trailing} {...shared} />
  )
}
