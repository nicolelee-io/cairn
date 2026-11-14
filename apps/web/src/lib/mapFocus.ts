interface Point {
  latitude: number
  longitude: number
}

const EARTH_KM = 6371

/** Great-circle distance in km. */
function km(a: Point, b: Point): number {
  const rad = Math.PI / 180
  const dLat = (b.latitude - a.latitude) * rad
  const dLon = (b.longitude - a.longitude) * rad
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * The pins to frame when the map opens: the most crowded neighbourhood, so a few trips abroad
 * don't zoom the map out to the whole globe. That is the pin with the most others within `radiusKm`,
 * plus those others. On a tie the earlier pin wins (the server sends newest first).
 */
export function densestArea<T extends Point>(points: T[], radiusKm = 150): T[] {
  let best: T[] = []
  for (const p of points) {
    const near = points.filter((q) => q === p || km(p, q) <= radiusKm)
    if (near.length > best.length) best = near
  }
  return best
}
