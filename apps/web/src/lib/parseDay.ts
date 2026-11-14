/**
 * A typed date as 'YYYY-MM-DD', or null if it isn't a real day. Takes the ISO form and the US
 * order (M/D/YYYY; `-` or `.` work as separators too). A two-digit year is not guessed at.
 */
export function parseDay(text: string): string | null {
  const t = text.trim()
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t)
  const us = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t)
  const [y, m, d] = iso ? [iso[1], iso[2], iso[3]] : us ? [us[3], us[1], us[2]] : []
  if (!y || !m || !d) return null
  const day = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  // Date rolls 2026-02-31 over to March, so a real day is one that comes back unchanged.
  const real = new Date(`${day}T00:00:00Z`)
  return !Number.isNaN(real.getTime()) && real.toISOString().startsWith(day) ? day : null
}
