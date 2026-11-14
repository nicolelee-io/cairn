import { cn } from '../lib/cn.ts'

const SIZES = { sm: 'size-5', md: 'size-10', lg: 'size-14' } as const

/**
 * The cairn's stones dropping in one by one and stacking, then lifting away to start again
 * (`.cairn-spinner` in index.css; still, with a soft pulse, under reduced motion). It fades in
 * after a short delay, so a wait of a moment never flashes it. Drawn from the same stones as
 * cairn.svg, in `currentColor`.
 */
export function Spinner({
  size = 'md',
  label = 'Loading',
  className,
}: {
  size?: keyof typeof SIZES
  /** Read out by screen readers. */
  label?: string
  className?: string
}) {
  return (
    <span
      role="status"
      className={cn('cairn-spinner inline-block text-on-surface-variant', className)}
    >
      <svg viewBox="70 100 380 360" aria-hidden="true" className={cn('block', SIZES[size])}>
        <path
          d="M84 450 C80 410 120 392 168 388 L316 382 C372 378 420 394 440 440 Z"
          fill="currentColor"
        />
        <g className="stone s1">
          <rect
            x="131"
            y="301"
            width="214"
            height="70"
            rx="29"
            fill="currentColor"
            transform="rotate(-2 238 336)"
          />
        </g>
        <g className="stone s2">
          <rect
            x="202"
            y="230"
            width="148"
            height="64"
            rx="27"
            fill="currentColor"
            transform="rotate(3 276 262)"
          />
        </g>
        <g className="stone s3">
          <rect
            x="196"
            y="170"
            width="92"
            height="56"
            rx="23"
            fill="currentColor"
            transform="rotate(-3 242 198)"
          />
        </g>
        <g className="stone s4">
          <ellipse cx="258" cy="140" rx="26" ry="30" fill="currentColor" />
        </g>
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  )
}

/** A spinner centred in the space of a pane, a page or a dialog while its content loads. */
export function LoadingState({ label, className }: { label?: string; className?: string }) {
  return (
    <div className={cn('flex justify-center py-12', className)}>
      <Spinner size="lg" label={label} />
    </div>
  )
}
