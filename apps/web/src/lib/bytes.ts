/** "1.5 MB": decimal units, one decimal under 10, none above. */
export function formatBytes(n: number): string {
  if (n < 1000) return `${Math.round(n)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n
  let i = -1
  do {
    v /= 1000
    i++
  } while (v >= 1000 && i < units.length - 1)
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}
