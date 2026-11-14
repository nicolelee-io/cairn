import type { ReactNode } from 'react'
import { cn } from '../lib/cn.ts'
import type { IconName } from '../components/Icon.tsx'
import { TopBar } from '../components/TopBar.tsx'

export function Page({
  title,
  icon,
  back,
  keepBack,
  wide,
  children,
}: {
  title: string
  icon?: IconName
  /** Shows a Back arrow in the top bar, in place of the menu button (`useGoBack`: where you came from, else the parent). */
  back?: boolean
  /** In Settings' pane from 840px the Back arrow is dropped (the list beside it is the way out); a page that is a child of another settings page keeps it. */
  keepBack?: boolean
  /** A wider column (64rem instead of 48rem) from 840px, for pages that lay out in two columns there. */
  wide?: boolean
  children?: ReactNode
}) {
  return (
    <section
      className={cn(
        'mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pt-0 pb-40 medium:px-8 large:pb-24',
        wide && 'expanded:max-w-5xl',
      )}
    >
      <TopBar
        title={title}
        icon={icon}
        back={back}
        keepBack={keepBack}
        bleed="-mx-4 px-4 medium:-mx-8 medium:px-8"
      />
      {children}
    </section>
  )
}

/** The page for a URL no route matches. */
export function NotFound() {
  return (
    <Page title="Page not found">
      <p className="rounded-lg bg-surface-container-low p-4 text-on-surface-variant">
        That page doesn’t exist.
      </p>
    </Page>
  )
}
