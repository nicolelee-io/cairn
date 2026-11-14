import { cn } from '../lib/cn.ts'

/**
 * The monochrome cairn, tinted with a theme colour (a CSS mask over icon-monochrome.svg), for
 * empty states. The default colour keeps AA contrast against the surfaces it sits on in both
 * themes; pass a `bg-*` class or a CSS `color` to change it.
 */
export function CairnMark({ className, color }: { className?: string; color?: string | null }) {
  return (
    <span
      aria-hidden="true"
      className={cn('block size-20 bg-on-surface-variant', className)}
      style={{
        backgroundColor: color ?? undefined,
        maskImage: 'url(/icon-monochrome.svg)',
        maskSize: 'contain',
        maskRepeat: 'no-repeat',
        maskPosition: 'center',
        WebkitMaskImage: 'url(/icon-monochrome.svg)',
        WebkitMaskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
      }}
    />
  )
}
