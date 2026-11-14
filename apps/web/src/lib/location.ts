import type { Location } from '@cairn/shared'

export function sameLocation(a: Location | null, b: Location | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.latitude === b.latitude &&
    a.longitude === b.longitude &&
    a.placeName === b.placeName &&
    a.locality === b.locality &&
    a.region === b.region &&
    a.country === b.country &&
    a.address === b.address &&
    a.googlePlaceId === b.googlePlaceId
  )
}

/** "Gas Works Park, Seattle, Washington", or the coordinates when nothing is named. */
export function locationLabel(l: Location): string {
  return (
    [l.placeName, l.locality, l.region].filter(Boolean).join(', ') ||
    `${l.latitude.toFixed(3)}, ${l.longitude.toFixed(3)}`
  )
}

/** A location holding only coordinates, for when there is no key or no address to look up. */
export const bareLocation = (latitude: number, longitude: number): Location => ({
  latitude,
  longitude,
  placeName: null,
  locality: null,
  region: null,
  country: null,
  address: null,
  googlePlaceId: null,
})
