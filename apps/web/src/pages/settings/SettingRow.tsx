import type { ReactNode } from 'react'
import { Icon } from '../../components/Icon.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Switch } from '../../components/ui/switch.tsx'

/** Where a setting is kept: on the account (every device), or in this browser only. */
export type Scope = 'account' | 'device'

/** The small "All your devices" / "This device only" line under a setting's description. */
export function ScopeNote({ scope }: { scope: Scope }) {
  return (
    <p className="mt-1 flex items-center gap-1 text-xs text-on-surface-variant">
      <Icon name={scope === 'device' ? 'mobile' : 'devices'} className="size-4" />
      {scope === 'device' ? 'This device only' : 'All your devices'}
    </p>
  )
}

/** A setting's title, description and scope note. */
export function SettingText({
  title,
  description,
  scope,
}: {
  title: string
  description: ReactNode
  scope: Scope
}) {
  return (
    <div className="min-w-0 flex-1">
      <p className="text-lg">{title}</p>
      <p className="text-sm text-on-surface-variant">{description}</p>
      <ScopeNote scope={scope} />
    </div>
  )
}

/** A setting that is on or off: its text, then a switch beside it. */
export function SwitchSetting({
  title,
  description,
  scope,
  label,
  checked,
  onChange,
}: {
  title: string
  description: ReactNode
  scope: Scope
  /** The switch's accessible name. */
  label: string
  checked: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <div className="flex items-center gap-4 rounded-lg bg-surface-container-low p-4">
      <SettingText title={title} description={description} scope={scope} />
      <Switch checked={checked} label={label} onChange={onChange} />
    </div>
  )
}

/** A row of toggle buttons, one pressed. */
export function ChoiceButtons<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  /** The button group's accessible name. */
  label: string
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <Button
          key={o.value}
          variant={value === o.value ? 'tonal' : 'outlined'}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </Button>
      ))}
    </div>
  )
}

/** A setting with a few named choices: its text, then a row of toggle buttons under it. */
export function ChoiceSetting<T extends string>({
  title,
  description,
  scope,
  label,
  options,
  value,
  onChange,
}: {
  title: string
  description: ReactNode
  scope: Scope
  label: string
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-surface-container-low p-4">
      <SettingText title={title} description={description} scope={scope} />
      <ChoiceButtons label={label} options={options} value={value} onChange={onChange} />
    </div>
  )
}
