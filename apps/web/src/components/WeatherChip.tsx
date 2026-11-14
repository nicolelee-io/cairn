import type { WeatherCondition } from '@cairn/shared'
import { formatTemp } from '../lib/format.ts'
import { useTempUnit } from '../lib/tempUnit.ts'
import { weatherIcon, weatherLabel } from '../lib/weather.ts'
import { Icon } from './Icon.tsx'

export function WeatherChip({
  condition,
  isDay = null,
  tempC,
  plain = false,
}: {
  condition: WeatherCondition
  isDay?: boolean | null
  tempC: number | null
  /** No background, for use inside another control. */
  plain?: boolean
}) {
  useTempUnit() // re-render when the unit changes
  return (
    <span
      className={
        plain
          ? 'inline-flex items-center gap-2'
          : 'inline-flex items-center gap-1 rounded-sm bg-tertiary-container px-2 py-0.5 text-xs text-on-tertiary-container'
      }
    >
      <Icon
        name={weatherIcon(condition, isDay)}
        className={plain ? 'size-5 text-tertiary' : 'size-4'}
      />
      <span>
        {tempC === null
          ? weatherLabel(condition)
          : `${formatTemp(tempC)} ${weatherLabel(condition)}`}
      </span>
    </span>
  )
}
