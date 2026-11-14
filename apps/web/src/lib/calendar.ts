export interface MonthGrid {
  /** 'October 2026' */
  label: string
  /** Weeks starting on Sunday; null pads the days outside the month. */
  weeks: (number | null)[][]
}

/** The calendar grid for a month (month is 1-12). Pure date maths, no time zones involved. */
export function monthGrid(year: number, month: number): MonthGrid {
  const first = new Date(Date.UTC(year, month - 1, 1))
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const cells: (number | null)[] = [
    ...Array<null>(first.getUTCDay()).fill(null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7))
  const label = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(first)
  return { label, weeks }
}
