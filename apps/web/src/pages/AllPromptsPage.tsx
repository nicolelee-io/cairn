import { useState } from 'react'
import type { Prompt } from '@cairn/shared'
import { EmptyState } from '../components/EmptyState.tsx'
import { NeedsConnection } from '../components/NeedsConnection.tsx'
import { PromptBrowser } from '../components/PromptBrowser.tsx'
import { PromptDialog } from '../components/PromptDialog.tsx'
import { LoadingState } from '../components/Spinner.tsx'
import { ConfirmDialog } from '../components/ui/dialog.tsx'
import {
  promptPath,
  useDeleteMyPrompts,
  useDeletePrompt,
  useMyPrompts,
  usePromptCategories,
  useUpdatePrompt,
} from '../lib/prompts.ts'
import { Page } from './Page.tsx'

/** All of your prompts, with a category filter and search. Tap one to write about it; the ⋮ edits or deletes. */
export function AllPromptsPage() {
  const mine = useMyPrompts()
  const categories = usePromptCategories().data?.categories
  const [editing, setEditing] = useState<Prompt | null>(null)
  const [deleting, setDeleting] = useState<Prompt | null>(null)
  const update = useUpdatePrompt()
  const remove = useDeletePrompt()
  const removeMany = useDeleteMyPrompts()
  const all = mine.data?.prompts ?? []

  return (
    <Page title="Your prompts" icon="lightbulb" back>
      {mine.isPending && <LoadingState />}
      {mine.isError && !mine.data && (
        <NeedsConnection onRetry={() => void mine.refetch()}>
          Reconnect to load your prompts.
        </NeedsConnection>
      )}
      {mine.data && all.length === 0 && (
        <EmptyState>No prompts yet. Save some from the suggested ones, or add your own.</EmptyState>
      )}
      {all.length > 0 && (
        <PromptBrowser
          prompts={all}
          categories={categories}
          linkTo={promptPath}
          onEdit={setEditing}
          onDelete={setDeleting}
          bulkDelete={{ run: removeMany.mutateAsync }}
        />
      )}

      <PromptDialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title="Edit prompt"
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
        title="Delete this prompt?"
        confirmLabel="Delete"
        pending={remove.isPending}
        error={
          remove.isError ? 'Couldn’t delete the prompt. Try again once you’re online.' : undefined
        }
        onConfirm={() =>
          deleting && remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) })
        }
      >
        <p className="font-entry text-on-surface-variant">{deleting?.text}</p>
      </ConfirmDialog>
    </Page>
  )
}
