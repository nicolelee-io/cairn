import { useState } from 'react'
import type { Template } from '@cairn/shared'
import { EmptyState } from '../components/EmptyState.tsx'
import { Icon } from '../components/Icon.tsx'
import { ListRow } from '../components/ListRow.tsx'
import { NeedsConnection } from '../components/NeedsConnection.tsx'
import { LoadingState } from '../components/Spinner.tsx'
import { TemplateDialog } from '../components/TemplateDialog.tsx'
import { Button } from '../components/ui/button.tsx'
import { ConfirmDialog } from '../components/ui/dialog.tsx'
import { useServerDown } from '../lib/serverStatus.ts'
import {
  useAddTemplate,
  useDeleteTemplate,
  useTemplates,
  useUpdateTemplate,
} from '../lib/templates.ts'
import { Page } from './Page.tsx'

/** The first line with something on it, for the row's muted line. */
const preview = (body: string) =>
  body
    .split('\n')
    .find((l) => l.trim())
    ?.trim()
    .slice(0, 100) ?? ''

/** Manage templates: add, edit and delete the saved text the editor inserts. Needs the server. */
export function TemplatesPage() {
  const templates = useTemplates()
  // Changes aren't queued, so while the server is down there is nothing to do here. (The editor still
  // inserts from the copy kept on this device.)
  const down = useServerDown()
  const add = useAddTemplate()
  const update = useUpdateTemplate()
  const remove = useDeleteTemplate()
  // `new` opens the add form, a template its edit form; deleting is its own confirm step.
  const [editing, setEditing] = useState<Template | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Template | null>(null)
  const list = templates.data?.templates ?? []

  const closeForm = () => {
    setEditing(null)
    add.reset()
    update.reset()
  }

  return (
    <Page title="Templates" icon="description" back>
      {down && (
        <NeedsConnection onRetry={() => void templates.refetch()}>
          Reconnect to add, edit or delete templates.
        </NeedsConnection>
      )}
      {!down && templates.isPending && <LoadingState />}
      {!down && templates.isError && <p role="alert">Couldn’t load templates.</p>}
      {!down && templates.data && (
        <>
          <Button variant="tonal" className="self-start" onClick={() => setEditing('new')}>
            <Icon name="add" />
            New template
          </Button>
          {list.length === 0 ? (
            <EmptyState>No templates yet. Add one to reuse its text in any entry.</EmptyState>
          ) : (
            <ul aria-label="Templates" className="flex flex-col gap-2">
              {list.map((t) => (
                <ListRow
                  key={t.id}
                  as="button"
                  label={`Edit ${t.name}`}
                  onClick={() => setEditing(t)}
                  className="rounded-lg bg-surface-container-low"
                  lead={
                    <Icon name="description" className="size-5 shrink-0 text-on-surface-variant" />
                  }
                  title={t.name}
                  lines={[
                    <span key="p" className="block truncate font-entry">
                      {preview(t.bodyMd)}
                    </span>,
                  ]}
                />
              ))}
            </ul>
          )}
        </>
      )}
      {/* Keyed so each opening starts from that template's own text. */}
      {!down && (
        <TemplateDialog
          key={editing === 'new' ? 'new' : (editing?.id ?? 'none')}
          open={editing !== null}
          onClose={closeForm}
          title={editing === 'new' || editing === null ? 'New template' : 'Edit template'}
          submitLabel={editing === 'new' ? 'Add' : 'Save'}
          edit={editing !== 'new'}
          initial={
            editing && editing !== 'new'
              ? { name: editing.name, bodyMd: editing.bodyMd }
              : undefined
          }
          pending={add.isPending || update.isPending}
          error={add.error ?? update.error}
          onSubmit={(value) => {
            const done = { onSuccess: closeForm }
            if (editing === 'new') add.mutate(value, done)
            else if (editing) update.mutate({ id: editing.id, ...value }, done)
          }}
          onDelete={
            editing && editing !== 'new'
              ? () => {
                  setDeleting(editing)
                  closeForm()
                }
              : undefined
          }
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => {
          setDeleting(null)
          remove.reset()
        }}
        title="Delete template?"
        confirmLabel="Delete"
        confirmIcon="delete"
        pending={remove.isPending}
        error={
          remove.isError ? 'Couldn’t delete the template. Try again once you’re online.' : null
        }
        onConfirm={() => {
          if (deleting)
            remove.mutate(deleting.id, {
              onSuccess: () => setDeleting(null),
            })
        }}
      >
        “{deleting?.name}” will be deleted. Entries you already wrote with it aren’t changed.
      </ConfirmDialog>
    </Page>
  )
}
