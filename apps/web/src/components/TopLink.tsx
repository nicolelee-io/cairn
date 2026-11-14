import type { MouseEvent } from 'react'
import { Link, type LinkProps } from 'react-router'
import { useTopNavigate } from '../lib/navigation.ts'

/**
 * A link to a top-level screen (Entries, a journal, Insights): following it resets the history
 * under it, so Back goes to Entries rather than through every journal looked at (`lib/navigation.ts`).
 * Modified clicks (new tab, new window) are left to the browser.
 */
export function TopLink({ to, onClick, ...props }: LinkProps & { to: string }) {
  const top = useTopNavigate()
  const click = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e)
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.altKey || e.ctrlKey || e.shiftKey)
      return
    e.preventDefault()
    top(to)
  }
  return <Link to={to} onClick={click} {...props} />
}
