import type { PromptCategory } from '@cairn/shared'
import { cn } from '../lib/cn.ts'
import { Icon, type IconName } from './Icon.tsx'

/**
 * A prompt's category as a small chip: its icon and name. `onCard` is for a chip sitting on a
 * `secondary-container` surface (the daily prompt cards), where a tint of the card's own text colour
 * stays readable in light and dark.
 */
export function CategoryChip({
  category,
  onCard = false,
  className,
}: {
  category: Pick<PromptCategory, 'name' | 'icon'>
  onCard?: boolean
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex h-6 max-w-full items-center gap-1 rounded-full px-2 text-xs font-medium',
        onCard
          ? 'bg-on-secondary-container/10 text-on-secondary-container'
          : 'bg-surface-container-high text-on-surface-variant',
        className,
      )}
    >
      <Icon name={category.icon as IconName} className="size-4 shrink-0" />
      <span className="truncate">{category.name}</span>
    </span>
  )
}
