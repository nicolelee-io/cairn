import type { InputHTMLAttributes } from 'react'
import { cn } from '../../lib/cn.ts'

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        // text-base (16px) also stops iOS zooming into the field on focus.
        'h-14 w-full rounded-sm border border-input bg-transparent px-4 text-base text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary disabled:opacity-40',
        className,
      )}
      {...props}
    />
  )
}
