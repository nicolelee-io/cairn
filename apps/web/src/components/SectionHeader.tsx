import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon.tsx'

/** The tonal circle that leads a section heading. */
export function IconCircle({ icon }: { icon: IconName }) {
  return (
    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-container text-on-primary-container">
      <Icon name={icon} className="size-5" />
    </span>
  )
}

/** The heading of a card or section: an icon in a tonal circle, then the title; anything after goes to the right. Insights and Prompts. */
export function SectionHeader({
  icon,
  title,
  children,
}: {
  icon: IconName
  title: string
  children?: ReactNode
}) {
  return (
    <div className="flex items-center gap-3">
      <IconCircle icon={icon} />
      <h2 className="text-xl">{title}</h2>
      {children}
    </div>
  )
}
