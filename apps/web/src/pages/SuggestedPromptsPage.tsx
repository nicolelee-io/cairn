import { useState } from 'react'
import { EmptyState } from '../components/EmptyState.tsx'
import { Icon, type IconName } from '../components/Icon.tsx'
import { ListRow } from '../components/ListRow.tsx'
import { NeedsConnection } from '../components/NeedsConnection.tsx'
import { IconCircle } from '../components/SectionHeader.tsx'
import { LoadingState } from '../components/Spinner.tsx'
import { Button } from '../components/ui/button.tsx'
import { Input } from '../components/ui/input.tsx'
import { plural } from '../lib/format.ts'
import {
  groupSuggested,
  savedSourceIds,
  useMyPrompts,
  usePromptCategories,
  useSaveSuggested,
  useSuggestedPrompts,
  type SuggestedGroup,
} from '../lib/prompts.ts'
import { showToast } from '../lib/toast.ts'
import { Page } from './Page.tsx'

/** Prompts drawn at a time inside an open category. */
const PAGE = 50

const searchKey = (s: string) => s.trim().toLowerCase()
const groupKey = (g: SuggestedGroup) => g.category?.id ?? 'none'

/**
 * Suggested prompts, grouped by category and collapsed to start with (a library can hold hundreds):
 * open one to see its prompts. Save copies one into your own list ("Saved" once it is there), Save
 * all copies the rest of a category. A search looks through every category and opens the ones with
 * matches; Save all then saves just the matches. What you save feeds the daily prompts.
 */
export function SuggestedPromptsPage() {
  const suggested = useSuggestedPrompts()
  const categories = usePromptCategories().data?.categories
  const mine = useMyPrompts()
  const save = useSaveSuggested()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const saved = savedSourceIds(mine.data?.prompts)
  const all = suggested.data?.prompts ?? []
  const q = searchKey(query)
  const matching = q ? all.filter((p) => searchKey(p.text).includes(q)) : all
  const groups = groupSuggested(matching, categories ?? [])

  const toggle = (key: string) =>
    setOpen((s) => {
      const next = new Set(s)
      if (!next.delete(key)) next.add(key)
      return next
    })

  const run = (ids: string[]) =>
    save.mutate(
      { ids },
      {
        onSuccess: (n) => showToast(`Saved ${plural(n, 'prompt', 'prompts')}`),
        onError: () => showToast('Couldn’t save. Try again once you’re online.'),
      },
    )

  return (
    <Page title="Suggested prompts" icon="lightbulb" back>
      {suggested.isPending && <LoadingState />}
      {suggested.isError && !suggested.data && (
        <NeedsConnection onRetry={() => void suggested.refetch()}>
          Reconnect to load suggested prompts.
        </NeedsConnection>
      )}
      {suggested.data && all.length === 0 && (
        <EmptyState>No suggested prompts yet. An admin can add them in Settings.</EmptyState>
      )}

      {all.length > 0 && (
        <Input
          type="search"
          aria-label="Search suggested prompts"
          placeholder="Search suggested prompts"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      {all.length > 0 && groups.length === 0 && (
        <p className="rounded-lg bg-surface-container-low p-4 text-on-surface-variant">
          No prompts match.
        </p>
      )}

      {groups.map((g) => (
        <Group
          key={groupKey(g)}
          group={g}
          // A search opens every category that has a match.
          expanded={!!q || open.has(groupKey(g))}
          onToggle={() => toggle(groupKey(g))}
          saved={saved}
          busy={save.isPending}
          searching={!!q}
          onSave={run}
        />
      ))}
    </Page>
  )
}

function Group({
  group,
  expanded,
  onToggle,
  saved,
  busy,
  searching,
  onSave,
}: {
  group: SuggestedGroup
  expanded: boolean
  onToggle: () => void
  saved: Set<string>
  busy: boolean
  searching: boolean
  onSave: (ids: string[]) => void
}) {
  const [limit, setLimit] = useState(PAGE)
  const name = group.category?.name ?? 'Other'
  const todo = group.prompts.filter((p) => !saved.has(p.id)).map((p) => p.id)
  const savedCount = group.prompts.length - todo.length
  const count = plural(group.prompts.length, 'prompt', 'prompts')

  return (
    <section aria-label={name} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-expanded={expanded}
          // While searching every group is open, so the button can't close one.
          disabled={searching}
          onClick={onToggle}
          className="state-layer flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-xl text-left disabled:cursor-default"
        >
          <IconCircle icon={(group.category?.icon ?? 'edit_note') as IconName} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xl">{name}</span>
            <span className="block text-sm text-on-surface-variant">
              {savedCount > 0 ? `${count} · ${savedCount} saved` : count}
            </span>
          </span>
          {!searching && (
            <Icon
              name={expanded ? 'keyboard_arrow_up' : 'keyboard_arrow_down'}
              className="shrink-0 text-on-surface-variant"
            />
          )}
        </button>
        {todo.length > 0 ? (
          <Button
            variant="tonal"
            size="sm"
            disabled={busy}
            aria-label={`Save ${searching ? '' : 'all '}${plural(todo.length, 'prompt', 'prompts')} in ${name}`}
            onClick={() => onSave(todo)}
          >
            {searching ? `Save ${todo.length}` : 'Save all'}
          </Button>
        ) : (
          <span className="flex shrink-0 items-center gap-1 px-2 text-sm text-on-surface-variant">
            <Icon name="check" className="size-4" />
            All saved
          </span>
        )}
      </div>

      {expanded && (
        <>
          <ul className="flex flex-col gap-2">
            {group.prompts.slice(0, limit).map((p) => {
              const isSaved = saved.has(p.id)
              return (
                <ListRow
                  key={p.id}
                  as="static"
                  className="rounded-lg bg-surface-container-low"
                  title={
                    <span className="line-clamp-4 font-entry whitespace-normal">{p.text}</span>
                  }
                  trailing={
                    isSaved ? (
                      <span className="flex h-10 shrink-0 items-center gap-1 px-3 text-sm text-on-surface-variant">
                        <Icon name="check" className="size-4" />
                        Saved
                      </span>
                    ) : (
                      <Button
                        variant="text"
                        disabled={busy}
                        aria-label={`Save: ${p.text}`}
                        onClick={() => onSave([p.id])}
                      >
                        Save
                      </Button>
                    )
                  }
                />
              )
            })}
          </ul>
          {group.prompts.length > limit && (
            <Button variant="tonal" className="self-center" onClick={() => setLimit(limit + PAGE)}>
              Show {Math.min(PAGE, group.prompts.length - limit)} more
            </Button>
          )}
        </>
      )}
    </section>
  )
}
