import { useState } from 'react'
import { WEATHER_CONDITIONS, type WeatherCondition, type WeatherEdit } from '@cairn/shared'
import { cn } from '../lib/cn.ts'
import { moveFocus } from '../lib/moveFocus.ts'
import { cToUnit, unitToC, useTempUnit } from '../lib/tempUnit.ts'
import { weatherIcon, weatherLabel } from '../lib/weather.ts'
import { Icon } from './Icon.tsx'
import { Button } from './ui/button.tsx'
import { Dialog, DialogActions } from './ui/dialog.tsx'

/**
 * Set an entry's weather by hand, remove it, or ask for the automatic one. Like the place, it is
 * part of the entry's edit: nothing is sent until Save.
 */
export function WeatherDialog({
  open,
  value,
  onClose,
  onApply,
}: {
  open: boolean
  value: WeatherEdit | null
  onClose: () => void
  onApply: (w: WeatherEdit | null) => void
}) {
  // Dialog mounts its children only while open, so the body's state starts fresh every time.
  return (
    <Dialog open={open} onClose={onClose} title="Weather">
      <WeatherBody value={value} onClose={onClose} onApply={onApply} />
    </Dialog>
  )
}

function WeatherBody({
  value,
  onClose,
  onApply,
}: {
  value: WeatherEdit | null
  onClose: () => void
  onApply: (w: WeatherEdit | null) => void
}) {
  const unit = useTempUnit()
  const manual = value && !('auto' in value) ? value : null
  const [condition, setCondition] = useState<WeatherCondition | null>(
    manual && manual.condition !== 'unknown' ? manual.condition : null,
  )
  const [temp, setTemp] = useState(
    manual?.tempC != null ? String(Math.round(cToUnit(manual.tempC, unit))) : '',
  )
  const parsed = temp.trim() === '' ? null : Number(temp)
  const tempOk = parsed === null || (Number.isFinite(parsed) && Math.abs(parsed) < 200)
  const conditions = WEATHER_CONDITIONS.filter((c) => c !== 'unknown')
  // One tab stop in the grid (the chosen condition, else the first); the arrows move within it.
  const stop = condition ?? conditions[0]
  const set = () =>
    condition &&
    tempOk &&
    onApply({
      condition,
      tempC: parsed === null ? null : Math.round(unitToC(parsed, unit) * 10) / 10,
      isDay: manual?.isDay ?? null,
    })

  return (
    <>
      <p className="text-sm text-on-surface-variant">
        Weather is added automatically when you save an entry with a place. Pick one here to set it
        yourself.
      </p>
      <div
        role="group"
        aria-label="Condition"
        className="grid grid-cols-3 gap-2"
        onKeyDown={(e) => moveFocus(e, 'button', 3)}
      >
        {conditions.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={condition === c}
            tabIndex={c === stop ? 0 : -1}
            data-autofocus={c === stop ? '' : undefined}
            onClick={() => setCondition(c)}
            className={cn(
              'state-layer flex cursor-pointer flex-col items-center gap-0.5 rounded-lg border px-1 py-1.5 text-xs',
              condition === c
                ? 'border-transparent bg-tertiary-container text-on-tertiary-container'
                : 'border-outline-variant',
            )}
          >
            <Icon name={weatherIcon(c, true)} className="size-5" />
            {weatherLabel(c)}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-3 text-sm">
        Temperature (°{unit})
        <input
          inputMode="numeric"
          value={temp}
          onChange={(e) => setTemp(e.target.value)}
          // The dialog sits inside the editor's form: Enter must not submit (Save) the entry. It
          // sets the weather instead, once a condition is chosen.
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            set()
          }}
          placeholder="optional"
          className="h-10 w-28 rounded-sm border border-input bg-transparent px-3 text-base outline-none focus-visible:border-primary"
        />
      </label>
      <Button variant="tonal" className="w-full" onClick={() => onApply({ auto: true })}>
        <Icon name="refresh" className="size-5" />
        Use automatic weather
      </Button>
      <DialogActions>
        {value && (
          <Button variant="text" onClick={() => onApply(null)}>
            Remove
          </Button>
        )}
        <Button variant="text" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!condition || !tempOk} onClick={set}>
          Set
        </Button>
      </DialogActions>
    </>
  )
}
