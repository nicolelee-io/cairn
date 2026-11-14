// Date/time editing in an entry's own timezone (SPEC 4). The inputs show wall-clock values in the
// chosen zone; these helpers convert between that and the stored epoch ms. Intl does the zone maths.

const parts = new Map<string, Intl.DateTimeFormat>()
function zoneFormat(tz: string): Intl.DateTimeFormat {
  let f = parts.get(tz)
  if (!f)
    parts.set(
      tz,
      (f = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })),
    )
  return f
}

/** The wall clock in `tz` at `ms`, as { date: 'YYYY-MM-DD', time: 'HH:mm' } (input-friendly). */
export function zonedFields(ms: number, tz: string): { date: string; time: string } {
  const p = Object.fromEntries(
    zoneFormat(tz)
      .formatToParts(ms)
      .map((x) => [x.type, x.value]),
  )
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }
}

/** How far `tz` is ahead of UTC at `ms`, in ms (whole seconds). */
function offsetAt(ms: number, tz: string): number {
  const p = Object.fromEntries(
    zoneFormat(tz)
      .formatToParts(ms)
      .map((x) => [x.type, x.value]),
  )
  const asUtc = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!)
  return asUtc - Math.floor(ms / 1000) * 1000
}

/**
 * The instant at which the wall clock in `tz` reads `date` 'YYYY-MM-DD' and `time` 'HH:mm'. Seconds
 * are zero. In the hour that repeats when clocks go back, the earlier (daylight) instant wins; a
 * time that doesn't exist when clocks go forward lands an hour later.
 */
export function fromZonedFields(date: string, time: string, tz: string): number | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const t = /^(\d{2}):(\d{2})$/.exec(time)
  if (!d || !t) return null
  const wall = Date.UTC(+d[1]!, +d[2]! - 1, +d[3]!, +t[1]!, +t[2]!)
  if (Number.isNaN(wall)) return null
  // The offset at the guess may differ from the offset at the answer across a DST change, so
  // settle on the first guess whose own offset reproduces it.
  const first = wall - offsetAt(wall, tz)
  const second = wall - offsetAt(first, tz)
  if (second === first) return first
  // Wall times either side of a change: prefer the earlier instant when both are valid.
  const candidates = [first, second].filter((c) => c + offsetAt(c, tz) === wall)
  return candidates.length ? Math.min(...candidates) : Math.max(first, second)
}

/** Every IANA zone the browser knows, always including `current` and UTC. */
export function timezoneOptions(current: string): string[] {
  let all: string[] = []
  try {
    all = Intl.supportedValuesOf('timeZone')
  } catch {
    // Old engine: fall back to just the zones we know about.
  }
  return [...new Set([current, 'UTC', ...all])].sort((a, b) => a.localeCompare(b))
}

/** The browser's own zone: where a new entry is written. */
export const browserTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone
