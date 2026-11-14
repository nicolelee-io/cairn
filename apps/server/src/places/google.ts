import type { Location } from '@cairn/shared'
import { PlacesError, type PlacesProvider } from './provider.ts'

interface Component {
  longText?: string
  long_name?: string
  types: string[]
}

const pick = (components: Component[], type: string) => {
  const c = components.find((x) => x.types.includes(type))
  return c ? (c.longText ?? c.long_name ?? null) : null
}

/** locality, falling back to the other names Google uses for "the town" in places without one. */
const locality = (cs: Component[]) =>
  pick(cs, 'locality') ??
  pick(cs, 'postal_town') ??
  pick(cs, 'sublocality') ??
  pick(cs, 'administrative_area_level_3')

/**
 * Google Places API (New) for search and details, the Geocoding API for coordinates. Called from the
 * backend only, so the key never reaches the browser. Nothing is cached: only the fields stored on
 * the entry are kept (SPEC 11.1).
 */
export function googlePlaces(apiKey: string, fetchImpl: typeof fetch = fetch): PlacesProvider {
  async function call(url: string, init: RequestInit = {}): Promise<unknown> {
    const res = await fetchImpl(url, {
      ...init,
      headers: { 'X-Goog-Api-Key': apiKey, 'Content-Type': 'application/json', ...init.headers },
      signal: AbortSignal.timeout(8000),
    }).catch((e: unknown) => {
      throw new PlacesError(`Google request failed: ${String(e)}`)
    })
    if (!res.ok) throw new PlacesError(`Google answered ${res.status}`)
    return res.json()
  }

  return {
    async search(query, bias, session) {
      const body = await call('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        body: JSON.stringify({
          input: query,
          sessionToken: session,
          ...(bias && {
            locationBias: {
              circle: {
                center: { latitude: bias.latitude, longitude: bias.longitude },
                radius: 50_000,
              },
            },
          }),
        }),
      })
      const suggestions =
        (
          body as {
            suggestions?: {
              placePrediction?: {
                placeId: string
                text?: { text: string }
                structuredFormat?: { mainText?: { text: string }; secondaryText?: { text: string } }
              }
            }[]
          }
        ).suggestions ?? []
      return suggestions.flatMap((s) => {
        const p = s.placePrediction
        if (!p) return [] // query predictions ("pizza near me") aren't places
        const name = p.structuredFormat?.mainText?.text ?? p.text?.text ?? ''
        return name
          ? [{ placeId: p.placeId, name, detail: p.structuredFormat?.secondaryText?.text ?? '' }]
          : []
      })
    },

    async details(placeId, session) {
      const q = session ? `?sessionToken=${encodeURIComponent(session)}` : ''
      const p = (await call(
        `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}${q}`,
        {
          headers: {
            'X-Goog-FieldMask': 'id,displayName,formattedAddress,location,addressComponents',
          },
        },
      )) as {
        id?: string
        displayName?: { text: string }
        formattedAddress?: string
        location?: { latitude: number; longitude: number }
        addressComponents?: Component[]
      }
      if (!p.location) return null
      const cs = p.addressComponents ?? []
      return {
        latitude: p.location.latitude,
        longitude: p.location.longitude,
        placeName: p.displayName?.text ?? null,
        locality: locality(cs),
        region: pick(cs, 'administrative_area_level_1'),
        country: pick(cs, 'country'),
        address: p.formattedAddress ?? null,
        googlePlaceId: p.id ?? placeId,
      } satisfies Location
    },

    async reverse(latitude, longitude) {
      const body = (await call(
        // The legacy Geocoding API reads the key from the query string, not the header.
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${encodeURIComponent(apiKey)}`,
      )) as {
        status?: string
        results?: {
          formatted_address?: string
          place_id?: string
          address_components: Component[]
        }[]
      }
      if (body.status === 'ZERO_RESULTS') return null
      if (body.status !== 'OK') throw new PlacesError(`Geocoding said ${body.status}`)
      const r = body.results?.[0]
      if (!r) return null
      const cs = r.address_components
      const street = [pick(cs, 'street_number'), pick(cs, 'route')].filter(Boolean).join(' ')
      return {
        latitude,
        longitude,
        // A street address when there is one, else the neighbourhood: a better label than coordinates.
        placeName: street || pick(cs, 'neighborhood') || pick(cs, 'establishment') || null,
        locality: locality(cs),
        region: pick(cs, 'administrative_area_level_1'),
        country: pick(cs, 'country'),
        address: r.formatted_address ?? null,
        googlePlaceId: r.place_id ?? null,
      }
    },
  }
}
