import { useState } from 'react'
import { Link } from 'react-router'
import { EmptyState } from '../components/EmptyState.tsx'
import { FilterChips } from '../components/FilterChips.tsx'
import { Icon } from '../components/Icon.tsx'
import { ListRow } from '../components/ListRow.tsx'
import { NeedsConnection } from '../components/NeedsConnection.tsx'
import { PromptCards } from '../components/PromptCards.tsx'
import { PromptDialog } from '../components/PromptDialog.tsx'
import { SectionHeader } from '../components/SectionHeader.tsx'
import { LoadingState } from '../components/Spinner.tsx'
import { Button, buttonVariants } from '../components/ui/button.tsx'
import {
  categoriesInUse,
  useAddPrompt,
  useCategoryPrompts,
  useDailyPrompts,
  useMyPrompts,
  usePromptCategories,
} from '../lib/prompts.ts'
import { Page } from './Page.tsx'

/**
 * Prompts: three daily prompts from your own list, a way into all of them, and buttons to browse
 * the suggested ones or add your own. Tapping a prompt starts an entry with it as the heading.
 */
export function PromptsPage() {
  const mine = useMyPrompts()
  const categories = usePromptCategories().data?.categories
  const { shown, refresh } = useDailyPrompts(mine.data?.prompts)
  const pick = useCategoryPrompts(mine.data?.prompts)
  const inUse = categoriesInUse(mine.data?.prompts, categories)
  const [adding, setAdding] = useState(false)
  const add = useAddPrompt()
  const count = mine.data?.prompts.length ?? 0

  return (
    <Page title="Prompts" icon="lightbulb" wide>
      {mine.isPending && <LoadingState />}
      {mine.isError && !mine.data && (
        <NeedsConnection onRetry={() => void mine.refetch()}>
          Reconnect to load your prompts. After that, today’s prompts work offline.
        </NeedsConnection>
      )}

      {mine.data && count === 0 && (
        <EmptyState>Save a few suggested prompts to get started.</EmptyState>
      )}

      {mine.data && count > 0 && (
        <section aria-label="Daily prompts" className="flex flex-col gap-3">
          <SectionHeader icon="lightbulb" title="Daily prompts">
            <Button
              variant="text"
              size="icon"
              className="ml-auto"
              aria-label="Show new prompts"
              onClick={refresh}
            >
              <Icon name="refresh" />
            </Button>
          </SectionHeader>
          <PromptCards prompts={shown ?? []} categories={categories} />
        </section>
      )}

      {mine.data && inUse.length > 0 && (
        <section aria-label="Pick a category" className="flex flex-col gap-3">
          <SectionHeader icon="sell" title="Pick a category">
            {pick.categoryId && (
              <Button
                variant="text"
                size="icon"
                className="ml-auto"
                aria-label="Show new prompts from this category"
                onClick={pick.refresh}
              >
                <Icon name="refresh" />
              </Button>
            )}
          </SectionHeader>
          <FilterChips
            label="Category"
            allLabel={null}
            options={inUse}
            value={pick.categoryId}
            // The chosen chip again puts it away.
            onChange={(id) => pick.choose(id === pick.categoryId ? null : id)}
          />
          {pick.categoryId ? (
            <PromptCards prompts={pick.shown ?? []} />
          ) : (
            <EmptyState>Pick a category to see three prompts.</EmptyState>
          )}
        </section>
      )}

      {mine.data && count > 0 && (
        <ul aria-label="Your prompts">
          <ListRow
            as="link"
            to="/prompts/all"
            className="rounded-lg bg-surface-container-low"
            lead={<Icon name="view_list" className="size-5 shrink-0 text-on-surface-variant" />}
            title={`Your prompts (${count})`}
            lines={['Search, edit or delete']}
            end={<Icon name="chevron_right" className="text-on-surface-variant" />}
          />
        </ul>
      )}

      <div className="flex flex-wrap justify-center gap-3">
        <Link to="/prompts/suggested" className={buttonVariants({ variant: 'tonal' })}>
          <Icon name="lightbulb" className="size-5" />
          Browse suggested prompts
        </Link>
        <Button variant="outlined" onClick={() => setAdding(true)}>
          <Icon name="add" className="size-5" />
          Add your own prompt
        </Button>
      </div>

      <PromptDialog
        open={adding}
        onClose={() => setAdding(false)}
        title="Add your own prompt"
        submitLabel="Add"
        pending={add.isPending}
        error={add.error}
        onSubmit={(v) => add.mutate(v, { onSuccess: () => setAdding(false) })}
      />
    </Page>
  )
}
