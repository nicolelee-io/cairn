import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/cn.ts'

// M3 buttons: pill-shaped, tonal fills, state layers rather than shadows.
export const buttonVariants = cva(
  'state-layer inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-40',
  {
    variants: {
      variant: {
        filled: 'bg-primary text-on-primary',
        tonal: 'bg-secondary-container text-on-secondary-container',
        outlined: 'border border-outline text-primary',
        text: 'text-primary',
        destructive: 'bg-error text-on-error',
      },
      size: {
        default: 'h-10 px-6',
        sm: 'h-8 px-4',
        icon: 'size-10',
      },
    },
    defaultVariants: { variant: 'filled', size: 'default' },
  },
)

export function Button({
  className,
  variant,
  size,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  )
}
