import { Link } from 'react-router'
import { useBarVisible } from '../lib/useBarVisible.ts'
import { useScrollChrome } from '../lib/scrollChrome.ts'
import { cn } from '../lib/cn.ts'
import { dismissToast, useToast } from '../lib/toast.ts'

const actionClass = 'state-layer rounded-full px-3 py-1.5 font-medium text-inverse-primary'

/** Renders the current toast (lib/toast.ts), above the bottom bar and the New entry button. */
export function Toaster() {
  const toast = useToast()
  const { barHidden } = useScrollChrome()
  const bar = useBarVisible() && !barHidden
  if (!toast) return null
  return (
    <div
      className={cn(
        'pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4 large:bottom-8',
        bar
          ? 'bottom-[calc(5rem+env(safe-area-inset-bottom))]'
          : 'bottom-[calc(1.5rem+env(safe-area-inset-bottom))]',
      )}
    >
      <div
        key={toast.id}
        role="status"
        className="pointer-events-auto flex items-center gap-3 rounded-full bg-inverse-surface py-2 pr-2 pl-5 text-sm text-inverse-on-surface shadow-lg"
      >
        <span>{toast.text}</span>
        {toast.action &&
          ('to' in toast.action ? (
            <Link to={toast.action.to} onClick={dismissToast} className={actionClass}>
              {toast.action.label}
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => {
                dismissToast()
                if (toast.action && 'onClick' in toast.action) toast.action.onClick()
              }}
              className={cn(actionClass, 'cursor-pointer')}
            >
              {toast.action.label}
            </button>
          ))}
      </div>
    </div>
  )
}
