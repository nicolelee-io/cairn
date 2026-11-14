const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
]
const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

/** "3 hours ago", "yesterday", "just now": how long before `now` a past time was. */
export function ago(at: number, now = Date.now()): string {
  const diff = now - at
  for (const [unit, ms] of UNITS) {
    if (diff >= ms) return rtf.format(-Math.floor(diff / ms), unit)
  }
  return 'just now'
}
