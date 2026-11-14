import type { Journal } from '@cairn/shared'
import type { useOfflineControls } from '../lib/useOfflineControls.ts'
import { Switch } from './ui/switch.tsx'

type Controls = ReturnType<typeof useOfflineControls>

/** One journal with its "keep on this device" switch and what it holds or would download. */
export function OfflineJournalRow({ journal, c }: { journal: Journal; c: Controls }) {
  const implied = c.isImplied(journal)
  return (
    <li className="flex items-center gap-4 py-1">
      <div className="min-w-0 flex-1">
        <p className="truncate">{journal.name}</p>
        <p className="text-sm text-on-surface-variant">
          {(c.isKept(journal) ? c.describe(journal) : null) ??
            (implied ? 'Included by “Keep all journals”' : c.describe(journal))}
        </p>
      </div>
      <Switch
        checked={implied || c.isKept(journal)}
        disabled={implied}
        label={`Keep ${journal.name} on this device`}
        onChange={(on) => void c.setJournal(journal, on)}
      />
    </li>
  )
}
