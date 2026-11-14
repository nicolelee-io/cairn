import { useState } from 'react'
import { useJournals } from '../../lib/queries.ts'
import { ExportControls } from '../../components/ExportControls.tsx'
import { Select } from '../../components/ui/select.tsx'

/** Download every journal, or one, as a Day One zip. */
export function ExportCard() {
  const journals = useJournals().data ?? []
  const [journalId, setJournalId] = useState('')
  // A journal deleted while this is open falls back to all of them.
  const chosen = journals.some((j) => j.id === journalId) ? journalId : ''
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-surface-container-low p-4">
      <div>
        <p className="text-lg">Export</p>
        <p className="text-sm text-on-surface-variant">
          Download your journals as a zip, archived ones included. Entries are in Day One&apos;s
          JSON format; some formatting, such as checklists, may not carry over perfectly.
        </p>
      </div>
      <Select
        label="Journal to export"
        value={chosen}
        onChange={setJournalId}
        options={[
          { value: '', label: 'All journals' },
          ...journals.map((j) => ({
            value: j.id,
            label: j.archivedAt ? `${j.name} (archived)` : j.name,
            dot: j.color,
          })),
        ]}
      />
      <ExportControls journalId={chosen || undefined} />
    </div>
  )
}
