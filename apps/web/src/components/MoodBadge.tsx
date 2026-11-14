import { moodByKey, type MoodKey } from '@cairn/shared'
import { cn } from '../lib/cn.ts'
import { useTip } from '../lib/useTip.tsx'

/** The emoji for a mood; renders nothing for an unrated entry. */
export function MoodBadge({ mood, className }: { mood: MoodKey | null; className?: string }) {
  const m = moodByKey(mood)
  const tip = useTip(m?.label)
  return m ? (
    <span
      role="img"
      aria-label={m.label}
      className={cn('font-emoji select-none', className)}
      {...tip.bind}
    >
      {m.emoji}
      {tip.node}
    </span>
  ) : null
}
