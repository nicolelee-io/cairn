import { useState, type InputHTMLAttributes } from 'react'
import { cn } from '../../lib/cn.ts'
import { Icon } from '../Icon.tsx'
import { Input } from './input.tsx'

/** A password `Input` with a button that shows or hides what is typed. */
export function PasswordInput({
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [shown, setShown] = useState(false)
  return (
    <div className="relative">
      <Input {...props} type={shown ? 'text' : 'password'} className={cn('pr-14', className)} />
      <button
        type="button"
        aria-label={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
        onClick={() => setShown((s) => !s)}
        className="state-layer absolute top-1/2 right-2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full text-on-surface-variant"
      >
        <Icon name={shown ? 'visibility_off' : 'visibility'} />
      </button>
    </div>
  )
}
