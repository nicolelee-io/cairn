import { useMutation, useQueryClient } from '@tanstack/react-query'
import { TRASH_RETENTION_DAYS, TrashSettingsSchema } from '@cairn/shared'
import { Select } from '../../components/ui/select.tsx'
import { api } from '../../lib/api.ts'
import { keys } from '../../lib/queries.ts'
import { useTrashSettings } from '../../lib/trash.ts'

const label = (d: number) => (d === 365 ? '1 year' : `${d} days`)

/** Server-wide: how long deleted entries and journals stay in the trash (admins only). */
export function TrashRetentionCard() {
  const qc = useQueryClient()
  const current = useTrashSettings().data?.retentionDays
  const save = useMutation({
    mutationFn: (retentionDays: number) =>
      api('/admin/trash', { method: 'PUT', body: { retentionDays }, schema: TrashSettingsSchema }),
    onSuccess: (s) => {
      qc.setQueryData(keys.adminTrash, s)
      // The delete wording and the trash's dates read it from /me and the trash lists.
      void qc.invalidateQueries({ queryKey: keys.me })
      void qc.invalidateQueries({ queryKey: keys.trash })
    },
  })
  if (current === undefined) return null
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-surface-container-low p-4">
      <div className="flex flex-wrap items-center gap-4">
        <p className="flex-1 text-lg">Keep deleted items</p>
        <Select
          label="Keep deleted items for"
          value={String(current)}
          options={TRASH_RETENTION_DAYS.map((d) => ({ value: String(d), label: label(d) }))}
          onChange={(v) => save.mutate(Number(v))}
        />
      </div>
      <p className="text-sm text-on-surface-variant">
        How long deleted items stay in Trash before they’re deleted for good. Applies to everyone.
        Lowering it removes older items at the next daily cleanup.
      </p>
      {save.isError && (
        <p role="alert" className="text-sm text-error">
          Couldn’t save the setting.
        </p>
      )}
    </div>
  )
}
