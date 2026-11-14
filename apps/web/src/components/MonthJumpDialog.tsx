import { cn } from '../lib/cn.ts'
import { LoadingState } from './Spinner.tsx'
import { Dialog } from './ui/dialog.tsx'

const MONTHS = Array.from({ length: 12 }, (_, i) =>
  new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2000, i, 1)),
  ),
)

/** Opens the picker on the newest year, at the bottom. */
const showNewest = (el: HTMLElement | null) => el?.scrollIntoView({ block: 'end' })

/**
 * Pick a month to jump the entry list to: a block of twelve months per year, newest year first,
 * only the years that have entries and only their months with entries enabled. `months` ('YYYY-MM')
 * is undefined while loading.
 */
export function MonthJumpDialog({
  open,
  onClose,
  months,
  current,
  onPick,
}: {
  open: boolean
  onClose: () => void
  months: string[] | undefined
  current?: string
  onPick: (month: string) => void
}) {
  const have = new Set(months)
  const years = [...new Set(months?.map((m) => Number(m.slice(0, 4))))].sort((a, b) => a - b)
  return (
    <Dialog open={open} onClose={onClose} title="Jump to month" showClose>
      {!months && <LoadingState label="Loading months" />}
      {years.map((year) => (
        <section
          key={year}
          ref={year === years.at(-1) ? showNewest : undefined}
          aria-label={String(year)}
          className="flex flex-col gap-2"
        >
          <h3 className="text-sm font-medium text-on-surface-variant">{year}</h3>
          <div className="grid grid-cols-4 gap-1">
            {MONTHS.map((name, i) => {
              const key = `${year}-${String(i + 1).padStart(2, '0')}`
              return (
                <button
                  key={key}
                  type="button"
                  disabled={!have.has(key)}
                  aria-current={key === current ? 'date' : undefined}
                  onClick={() => onPick(key)}
                  className={cn(
                    'state-layer grid h-11 cursor-pointer place-items-center rounded-lg text-base disabled:cursor-default disabled:opacity-40',
                    key === current
                      ? 'bg-primary-container text-on-primary-container'
                      : 'bg-surface-container-low',
                  )}
                >
                  {name}
                </button>
              )
            })}
          </div>
        </section>
      ))}
    </Dialog>
  )
}
