import { useState } from 'react'
import { fromZonedFields, zonedFields } from '../../lib/entryTime.ts'
import { dayKey } from '../../lib/format.ts'
import { Icon } from '../Icon.tsx'
import { Button } from '../ui/button.tsx'
import { Dialog, DialogActions } from '../ui/dialog.tsx'
import { Switch } from '../ui/switch.tsx'
import { Calendar } from './Calendar.tsx'
import { TimeField } from './TimeField.tsx'
import { TimezoneDialog } from './TimezoneDialog.tsx'

export interface When {
  createdAt: number
  timezone: string
  allDay: boolean
}

/**
 * Date, time, timezone and all-day. The date and time are the wall clock in the chosen zone, so
 * changing only the zone keeps the clock reading and moves the instant (the usual fix for an entry
 * stamped with the wrong zone).
 */
export function DateTimeDialog({
  open,
  value,
  onClose,
  onApply,
}: {
  open: boolean
  value: When
  onClose: () => void
  onApply: (v: When) => void
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Date and time">
      {/* Remounted per open so the fields start from the entry's current values. */}
      {open && <Fields value={value} onClose={onClose} onApply={onApply} />}
    </Dialog>
  )
}

function Fields({
  value,
  onClose,
  onApply,
}: {
  value: When
  onClose: () => void
  onApply: (v: When) => void
}) {
  const initial = zonedFields(value.createdAt, value.timezone)
  const [date, setDate] = useState(initial.date)
  const [time, setTime] = useState(initial.time)
  const [tz, setTz] = useState(value.timezone)
  const [allDay, setAllDay] = useState(value.allDay)
  const [zoneOpen, setZoneOpen] = useState(false)
  const [now] = useState(() => Date.now())

  // An all-day entry keeps whatever time it had; the time is just not shown.
  const ms = fromZonedFields(date, time || '00:00', tz)

  return (
    <>
      {/* Not a <form>: this dialog is rendered inside the editor's own form, and forms can't nest
          (a nested submit also reached the editor's Save). */}
      <div className="flex flex-col gap-5">
        <Calendar value={date} today={dayKey(now, tz)} onChange={setDate} />

        <div>
          <p className="mb-1 text-sm text-on-surface-variant">Time</p>
          <TimeField
            value={time}
            onChange={setTime}
            disabled={allDay}
            trailing={
              <div className="flex flex-col items-start gap-1 text-sm text-on-surface-variant">
                All day
                <Switch checked={allDay} onChange={setAllDay} label="All day" />
              </div>
            }
          />
        </div>

        <button
          type="button"
          onClick={() => setZoneOpen(true)}
          className="state-layer flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-sm border border-input px-4 py-2 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-xs text-on-surface-variant">Timezone</span>
            <span className="block truncate text-base">{tz.replaceAll('_', ' ')}</span>
          </span>
          <Icon name="chevron_right" className="size-5 text-on-surface-variant" />
        </button>

        <Button
          variant="tonal"
          className="w-full"
          onClick={() => {
            // The current moment, as the wall clock of the chosen zone.
            const n = zonedFields(Date.now(), tz)
            setDate(n.date)
            setTime(n.time)
          }}
        >
          <Icon name="schedule" className="size-5" />
          Set to now
        </Button>

        <DialogActions>
          <Button variant="text" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={ms === null}
            onClick={() => ms !== null && onApply({ createdAt: ms, timezone: tz, allDay })}
          >
            Done
          </Button>
        </DialogActions>
      </div>

      {/* Its search box is a field of the editor's form: see TimezoneDialog for how Enter is handled. */}
      <TimezoneDialog
        open={zoneOpen}
        value={tz}
        at={ms ?? now}
        onClose={() => setZoneOpen(false)}
        onPick={(z) => {
          setTz(z)
          setZoneOpen(false)
        }}
      />
    </>
  )
}
