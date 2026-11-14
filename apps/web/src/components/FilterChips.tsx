import { cn } from '../lib/cn.ts'

/** A row of toggle chips (one on at a time): an "All" chip (renamable with `allLabel`, or left out with `null`) plus one per option. */
export function FilterChips({
  label,
  options,
  value,
  allLabel = 'All',
  onChange,
}: {
  /** Accessible name of the group. */
  label: string
  options: { id: string; name: string }[]
  /** The chosen option's id, or null for All. */
  value: string | null
  /** The first chip's text ("No category" in a form); null leaves that chip out. */
  allLabel?: string | null
  onChange: (id: string | null) => void
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {allLabel !== null && (
        <Chip label={allLabel} on={value === null} onClick={() => onChange(null)} />
      )}
      {options.map((o) => (
        <Chip key={o.id} label={o.name} on={value === o.id} onClick={() => onChange(o.id)} />
      ))}
    </div>
  )
}

function Chip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'state-layer inline-flex h-8 cursor-pointer items-center rounded-full border px-3 text-sm',
        on
          ? 'border-transparent bg-secondary-container text-on-secondary-container'
          : 'border-outline-variant text-on-surface-variant',
      )}
    >
      {label}
    </button>
  )
}
