import { useState } from 'react'
import type { PromptCategory, SuggestedPrompt } from '@cairn/shared'
import { useMe } from '../auth/useAuth.ts'
import { Icon, type IconName } from '../components/Icon.tsx'
import { NeedsConnection } from '../components/NeedsConnection.tsx'
import { PromptBrowser } from '../components/PromptBrowser.tsx'
import { PromptDialog } from '../components/PromptDialog.tsx'
import { SectionHeader } from '../components/SectionHeader.tsx'
import { LoadingState } from '../components/Spinner.tsx'
import { Button } from '../components/ui/button.tsx'
import { ConfirmDialog } from '../components/ui/dialog.tsx'
import { cn } from '../lib/cn.ts'
import {
  useCreateSuggested,
  useDeleteSuggested,
  useDeleteSuggestedMany,
  usePromptCategories,
  useReorderCategories,
  useSuggestedPrompts,
  useUpdateSuggested,
} from '../lib/prompts.ts'
import { useServerDown } from '../lib/serverStatus.ts'
import { useReorder } from '../lib/useReorder.ts'
import { Page } from './Page.tsx'
import { PromptCategoryDialog } from './settings/PromptCategoryDialog.tsx'
import { PromptImportDialog } from './settings/PromptImportDialog.tsx'

/**
 * Manage suggested prompts (admins; the server refuses everyone else too): the categories every
 * prompt can use, and the server-wide list of suggested prompts people browse and save from.
 */
export function AdminPromptsPage() {
  const isAdmin = useMe().data?.role === 'admin'
  const down = useServerDown()
  const categories = usePromptCategories()
  const suggested = useSuggestedPrompts()

  return (
    <Page title="Suggested prompts" icon="lightbulb" back>
      {!isAdmin ? (
        <p className="rounded-lg bg-surface-container-low p-4 text-on-surface-variant">
          Only an admin can manage suggested prompts.
        </p>
      ) : down ? (
        <NeedsConnection
          onRetry={() => {
            void categories.refetch()
            void suggested.refetch()
          }}
        >
          Reconnect to manage suggested prompts.
        </NeedsConnection>
      ) : categories.data && suggested.data ? (
        <Manager categories={categories.data.categories} prompts={suggested.data.prompts} />
      ) : (
        <LoadingState />
      )}
    </Page>
  )
}

function Manager({
  categories,
  prompts,
}: {
  categories: PromptCategory[]
  prompts: SuggestedPrompt[]
}) {
  // An id, not the category: the dialog then reads the list's copy. `null` is a new category.
  const [editingCategory, setEditingCategory] = useState<PromptCategory | 'new' | null>(null)
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const [editing, setEditing] = useState<SuggestedPrompt | null>(null)
  const [deleting, setDeleting] = useState<SuggestedPrompt | null>(null)
  const create = useCreateSuggested()
  const update = useUpdateSuggested()
  const remove = useDeleteSuggested()
  const removeMany = useDeleteSuggestedMany()
  const saveOrder = useReorderCategories()
  const reorder = useReorder(
    categories.map((c) => c.id),
    (ids) => saveOrder.mutate(ids),
  )
  const byId = new Map(categories.map((c) => [c.id, c]))
  const ordered = reorder.order.flatMap((id) => byId.get(id) ?? [])
  const countIn = (id: string) => prompts.filter((p) => p.categoryId === id).length

  return (
    <>
      <section aria-label="Categories" className="flex flex-col gap-3">
        <SectionHeader icon="sell" title="Categories">
          <Button
            variant="tonal"
            size="sm"
            className="ml-auto"
            onClick={() => setEditingCategory('new')}
          >
            <Icon name="add" className="size-4" />
            Add
          </Button>
        </SectionHeader>
        {categories.length === 0 ? (
          <p className="rounded-lg bg-surface-container-low p-4 text-on-surface-variant">
            No categories yet. Add some to group prompts (Reflection, Gratitude…), or import a file
            that names them.
          </p>
        ) : (
          <ul aria-label="Categories" className="flex flex-col gap-2">
            {ordered.map((c) => (
              <li
                key={c.id}
                ref={reorder.rowRef(c.id)}
                style={reorder.style(c.id)}
                className={cn(
                  'relative flex items-center gap-1 rounded-lg bg-surface-container-low pr-1',
                  reorder.draggingId === c.id && 'bg-surface-container-high shadow-md',
                )}
              >
                {categories.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Reorder ${c.name}`}
                    title="Drag, or use the up and down arrow keys"
                    className="state-layer grid size-10 shrink-0 cursor-grab touch-none place-items-center rounded-full text-on-surface-variant active:cursor-grabbing"
                    {...reorder.handleProps(c.id)}
                  >
                    <Icon name="drag_indicator" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setEditingCategory(c)}
                  aria-label={`Edit ${c.name}`}
                  className="state-layer flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-3 text-left"
                >
                  <Icon
                    name={c.icon as IconName}
                    className="size-5 shrink-0 text-on-surface-variant"
                  />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <span className="text-sm text-on-surface-variant">{countIn(c.id)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Suggested prompts" className="flex flex-col gap-3">
        <SectionHeader icon="lightbulb" title={`Prompts (${prompts.length})`} />
        <div className="flex flex-wrap gap-3">
          <Button variant="tonal" onClick={() => setAdding(true)}>
            <Icon name="add" className="size-5" />
            Add prompt
          </Button>
          <Button variant="outlined" onClick={() => setImporting(true)}>
            <Icon name="upload_file" className="size-5" />
            Import JSON
          </Button>
        </div>
        {prompts.length > 0 && (
          <PromptBrowser
            prompts={prompts}
            categories={categories}
            onEdit={setEditing}
            onDelete={setDeleting}
            bulkDelete={{
              run: removeMany.mutateAsync,
              note: 'Copies people have already saved stay in their lists.',
            }}
          />
        )}
      </section>

      {editingCategory && (
        <PromptCategoryDialog
          key={editingCategory === 'new' ? 'new' : editingCategory.id}
          category={editingCategory === 'new' ? null : editingCategory}
          promptCount={editingCategory === 'new' ? 0 : countIn(editingCategory.id)}
          onClose={() => setEditingCategory(null)}
        />
      )}
      {importing && <PromptImportDialog onClose={() => setImporting(false)} />}
      <PromptDialog
        open={adding}
        onClose={() => setAdding(false)}
        title="Add suggested prompt"
        submitLabel="Add"
        pending={create.isPending}
        error={create.error}
        onSubmit={(v) => create.mutate(v, { onSuccess: () => setAdding(false) })}
      />
      <PromptDialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title="Edit suggested prompt"
        initial={editing ?? undefined}
        pending={update.isPending}
        error={update.error}
        onSubmit={(v) =>
          editing && update.mutate({ id: editing.id, ...v }, { onSuccess: () => setEditing(null) })
        }
      />
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete this suggested prompt?"
        confirmLabel="Delete"
        pending={remove.isPending}
        error={remove.isError ? 'Couldn’t delete the prompt.' : undefined}
        onConfirm={() =>
          deleting && remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) })
        }
      >
        <p className="font-entry text-on-surface-variant">{deleting?.text}</p>
        <p className="text-sm text-on-surface-variant">
          Copies people have already saved stay in their lists.
        </p>
      </ConfirmDialog>
    </>
  )
}
