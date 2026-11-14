import { MOODS, type Mood } from '@cairn/shared'
import { cn } from '../lib/cn.ts'

/** Rows per column: the first seven moods (good and neutral) fill the left, the other seven the right. */
export const MOOD_ROWS = MOODS.length / 2

function Row({ m }: { m: Mood }) {
  return (
    <>
      <span aria-hidden="true" className="font-emoji w-9 text-center text-2xl leading-none">
        {m.emoji}
      </span>
      <span className="truncate">{m.label}</span>
    </>
  )
}

const GRID = 'grid w-max grid-flow-col grid-cols-2 gap-x-1'
const ROW = 'flex h-11 min-w-40 items-center gap-2 rounded-full pr-4 pl-2 text-left'

/**
 * Every mood as an emoji and its name, two columns of seven (the order of `MOODS`, read down the left
 * column then the right). With `onPick` the rows are buttons and `value` is the chosen one (the editor's
 * picker); without it they are plain list items (the calendar's key). One markup for both.
 */
export function MoodGrid({
  value,
  onPick,
}: {
  value?: string | null
  onPick?: (m: Mood, e: React.MouseEvent) => void
}) {
  const style = { gridTemplateRows: `repeat(${MOOD_ROWS}, auto)` }
  if (!onPick)
    return (
      <ul style={style} className={cn(GRID, 'gap-y-1')}>
        {MOODS.map((m) => (
          <li key={m.key} className={ROW}>
            <Row m={m} />
          </li>
        ))}
      </ul>
    )
  return (
    <div style={style} className={cn(GRID, 'gap-y-1')}>
      {MOODS.map((m) => {
        const on = m.key === value
        return (
          <button
            key={m.key}
            type="button"
            aria-pressed={on}
            onClick={(e) => onPick(m, e)}
            className={cn(
              ROW,
              'state-layer cursor-pointer transition',
              on ? 'bg-secondary-container' : 'text-on-surface-variant',
            )}
          >
            <Row m={m} />
          </button>
        )
      })}
    </div>
  )
}
