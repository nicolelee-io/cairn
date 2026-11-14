import { cn } from '../../lib/cn.ts'

/** M3 switch: a 52x32 track whose thumb grows and slides when on. */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean
  onChange: (on: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'tap-target relative h-8 w-[3.25rem] shrink-0 cursor-pointer rounded-full border-2 transition-colors',
        disabled && 'cursor-default opacity-50',
        checked ? 'border-primary bg-primary' : 'border-outline bg-surface-container-highest',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute top-1/2 left-0 -translate-y-1/2 rounded-full transition-all',
          checked ? 'size-6 translate-x-5 bg-on-primary' : 'size-4 translate-x-1.5 bg-outline',
        )}
      />
    </button>
  )
}
