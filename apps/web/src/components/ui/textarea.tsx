import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn.ts'

/** The multi-line twin of `Input`: same outline, text-base so iOS doesn't zoom in on focus. */
export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'min-h-24 w-full resize-none rounded-sm border border-input bg-transparent px-4 py-3 text-base text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary disabled:opacity-40',
        className,
      )}
      {...props}
    />
  )
}
