import type { Location, PlaceSuggestion } from '@cairn/shared'

/** A point to favour in results (where the user is, or the entry already is). */
export interface Bias {
  latitude: number
  longitude: number
}

/** The place lookups the app needs; Google is one implementation, tests use a fake. */
export interface PlacesProvider {
  search(query: string, bias?: Bias, session?: string): Promise<PlaceSuggestion[]>
  details(placeId: string, session?: string): Promise<Location | null>
  /** The best description of a coordinate (current location, a photo's GPS). Null when nothing is there. */
  reverse(latitude: number, longitude: number): Promise<Location | null>
}

/** The provider failed or refused; the route turns it into a 502. */
export class PlacesError extends Error {}
