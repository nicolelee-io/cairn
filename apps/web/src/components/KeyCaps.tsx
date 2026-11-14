import { Fragment } from 'react'
import { asList, keyCaps } from '../lib/shortcutKeys.ts'

/** One key cap. */
function Cap({ children }: { children: string }) {
  return (
    <kbd className="inline-grid min-w-6 place-items-center rounded-md border border-outline-variant bg-surface-container px-1.5 py-0.5 font-sans text-xs leading-none text-on-surface">
      {children}
    </kbd>
  )
}

/** A shortcut's keys as key caps; alternatives are separated by "or", chord steps by "then". */
export function KeyCaps({ keys }: { keys: string | string[] }) {
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-x-1.5 gap-y-1">
      {asList(keys).map((seq, i) => (
        <Fragment key={seq}>
          {i > 0 && <span className="text-xs text-on-surface-variant">or</span>}
          {keyCaps(seq).map((step, j) => (
            <Fragment key={j}>
              {j > 0 && <span className="text-xs text-on-surface-variant">then</span>}
              <span className="inline-flex items-center gap-0.5">
                {step.map((cap, k) => (
                  <Cap key={k}>{cap}</Cap>
                ))}
              </span>
            </Fragment>
          ))}
        </Fragment>
      ))}
    </span>
  )
}
