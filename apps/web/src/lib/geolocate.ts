import { LocationSchema, type Location } from '@cairn/shared'
import { ApiError, api } from './api.ts'
import { bareLocation } from './location.ts'

/** The device's position (browser geolocation; needs https or localhost). Rejects if refused. */
export function currentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('unsupported'))
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
    })
  })
}

/**
 * A coordinate described by the server (needs the Google key). Nothing at that spot keeps the bare
 * coordinates; any other failure is thrown so the caller can say why.
 */
export const describePoint = (latitude: number, longitude: number): Promise<Location> =>
  api(`/places/reverse?lat=${latitude}&lng=${longitude}`, { schema: LocationSchema }).catch((e) => {
    if (e instanceof ApiError && e.status === 404) return bareLocation(latitude, longitude)
    throw e
  })
