import { useNavigate } from 'react-router'
import { dismissOutboxFailures } from '../lib/outbox.ts'
import { useOutboxState } from '../lib/useOutbox.ts'
import { Button } from './ui/button.tsx'

/**
 * Shown only when a save made offline was refused by the server and went back to being a draft:
 * the one thing that needs the user to act. Being offline, or having saves waiting, is not an
 * alert; it shows as a quiet status in the nav and the top bar (SyncStatus, SyncIndicator). It
 * sits in the page flow, so it never covers a control.
 */
export function ServerBanner() {
  const navigate = useNavigate()
  const { failed, review, message } = useOutboxState()
  if (failed === 0) return null
  return (
    <div
      role="alert"
      className="flex items-center justify-center gap-3 bg-error-container px-4 py-2 text-sm text-on-error-container"
    >
      <span>
        {message ??
          "Couldn't save a change you made offline. The entry may have changed somewhere else. Your text is back as a draft."}
      </span>
      {review && (
        <Button
          variant="text"
          size="sm"
          onClick={() => {
            dismissOutboxFailures()
            navigate(review)
          }}
        >
          Review
        </Button>
      )}
      <Button variant="text" size="sm" onClick={dismissOutboxFailures}>
        Dismiss
      </Button>
    </div>
  )
}
