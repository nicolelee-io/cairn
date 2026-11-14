import { Link } from 'react-router'
import type { Prompt, PromptCategory } from '@cairn/shared'
import { categoryById, promptPath } from '../lib/prompts.ts'
import { CategoryChip } from './CategoryChip.tsx'

/**
 * Prompts as tonal cards in Literata, stacked on a phone and three across from 840px. A card starts
 * an entry with that prompt. The daily prompts and the pick-a-category section both use it; pass
 * `categories` to show each card's category chip.
 */
export function PromptCards({
  prompts,
  categories,
}: {
  prompts: Prompt[]
  categories?: PromptCategory[]
}) {
  return (
    <ul className="grid gap-3 expanded:grid-cols-3">
      {prompts.map((p) => {
        const category = categories && categoryById(categories, p.categoryId)
        return (
          <li key={p.id} className="flex">
            <Link
              to={promptPath(p.text)}
              className="state-layer flex min-h-32 w-full flex-col justify-between gap-4 rounded-xl bg-secondary-container p-4 text-on-secondary-container"
            >
              <span className="font-entry text-lg leading-snug">{p.text}</span>
              {category && <CategoryChip category={category} onCard className="self-start" />}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
