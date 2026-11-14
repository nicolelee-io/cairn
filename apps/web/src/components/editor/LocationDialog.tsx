import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import {
  LocationSchema,
  PlaceSuggestionsSchema,
  RecentPlacesSchema,
  uuidv7,
  type Location,
  type Photo,
} from '@cairn/shared'
import { useMe } from '../../auth/useAuth.ts'
import { api, errorCode } from '../../lib/api.ts'
import { keys } from '../../lib/queries.ts'
import { currentPosition, describePoint } from '../../lib/geolocate.ts'
import { bareLocation, locationLabel } from '../../lib/location.ts'
import { moveFocus } from '../../lib/moveFocus.ts'
import { isUnreachable } from '../../lib/outbox.ts'
import { autofocusWithMouse } from '../../lib/pointer.ts'
import { useServerDown } from '../../lib/serverStatus.ts'
import { Icon } from '../Icon.tsx'
import { OfflineNote } from '../NeedsConnection.tsx'
import { Button } from '../ui/button.tsx'
import { Dialog, DialogActions } from '../ui/dialog.tsx'

const row =
  'state-layer flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left disabled:opacity-40'

function Spinner() {
  return (
    <span
      role="status"
      aria-label="Working"
      className="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent"
    />
  )
}

/**
 * A name for a place, in the user's own words ("Home", "Backcountry camp"), for when there is no
 * address lookup or the lookup's name isn't the one wanted. Blank means no name. The dialog sits
 * inside the editor's form, so Enter here saves the name and never submits the entry.
 */
function PlaceNameField({
  initial,
  action,
  alwaysEnabled = false,
  onSubmit,
}: {
  initial: string
  /** The button's label. */
  action: string
  /** Enabled even with the name unchanged (saving the coordinates alone is a valid choice). */
  alwaysEnabled?: boolean
  onSubmit: (name: string | null) => void
}) {
  const [name, setName] = useState(initial)
  const trimmed = name.trim()
  const submit = () => onSubmit(trimmed || null)
  return (
    <div className="flex flex-wrap items-center gap-2 pr-1">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          e.preventDefault()
          if (alwaysEnabled || trimmed !== initial.trim()) submit()
        }}
        maxLength={300}
        placeholder="Place name (optional)"
        aria-label="Place name (optional)"
        data-row=""
        className="h-10 min-w-0 flex-1 basis-40 rounded-sm border border-input bg-transparent px-3 text-base outline-none placeholder:text-on-surface-variant focus-visible:border-primary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
      />
      <Button
        variant="tonal"
        size="sm"
        disabled={!alwaysEnabled && trimmed === initial.trim()}
        onClick={submit}
      >
        {action}
      </Button>
    </div>
  )
}

/** Tag, change or remove an entry's place: current location, search, or a photo's GPS. */
export function LocationDialog({
  open,
  onClose,
  ...rest
}: {
  open: boolean
  value: Location | null
  /** Photos that may carry GPS from their EXIF. */
  photos: Photo[]
  onClose: () => void
  onApply: (l: Location | null) => void
}) {
  // Dialog mounts its children only while open, so the body's state starts fresh every time.
  return (
    <Dialog open={open} onClose={onClose} title="Place">
      <PlaceBody onClose={onClose} {...rest} />
    </Dialog>
  )
}

function PlaceBody({
  value,
  photos,
  onClose,
  onApply,
}: {
  value: Location | null
  /** Photos that may carry GPS from their EXIF. */
  photos: Photo[]
  onClose: () => void
  onApply: (l: Location | null) => void
}) {
  const admin = useMe().data?.role === 'admin'
  const [text, setText] = useState('')
  const [debounced, setDebounced] = useState('')
  // Which action is running (for its spinner); null when idle.
  const [busy, setBusy] = useState<string | null>(null)
  // Set when an address lookup failed: the coordinates alone can still be saved.
  const [coordsOnly, setCoordsOnly] = useState<Location | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  // A lookup found no server. Not an error: GPS still works, so the coordinates can be kept.
  const [lookupOffline, setLookupOffline] = useState(false)
  const down = useServerDown()
  // One autocomplete session per open: Google bills the typing and the pick as one request.
  const [session] = useState(() => uuidv7())
  useEffect(() => {
    const t = setTimeout(() => setDebounced(text.trim()), 300)
    return () => clearTimeout(t)
  }, [text])

  const bias = value ? `&lat=${value.latitude}&lng=${value.longitude}` : ''
  const search = useQuery({
    queryKey: keys.placesSearch(debounced, bias),
    queryFn: () =>
      api(`/places/search?q=${encodeURIComponent(debounced)}&session=${session}${bias}`, {
        schema: PlaceSuggestionsSchema,
      }),
    enabled: debounced.length >= 2 && !down,
    retry: false,
    staleTime: 60_000,
  })

  // Places from earlier entries, a shortcut before anything is typed. Under 'entries' so a save
  // refreshes it.
  const recent = useQuery({
    queryKey: keys.recentPlaces,
    queryFn: () => api('/entries/recent-places', { schema: RecentPlacesSchema }),
    staleTime: 30_000,
  })

  // Distinct spots, rounded to ~10m, so ten photos from one place are one choice.
  const photoSpots = useMemo(() => {
    const seen = new Map<string, { n: number; lat: number; lng: number }>()
    photos.forEach((p, i) => {
      if (p.latitude === null || p.longitude === null) return
      const k = `${p.latitude.toFixed(4)},${p.longitude.toFixed(4)}`
      if (!seen.has(k)) seen.set(k, { n: i + 1, lat: p.latitude, lng: p.longitude })
    })
    return [...seen.values()]
  }, [photos])

  const run = async (key: string, job: () => Promise<Location>) => {
    setBusy(key)
    setMessage(null)
    setCoordsOnly(null)
    setLookupOffline(false)
    try {
      onApply(await job())
    } catch (e) {
      if (isUnreachable(e)) return setLookupOffline(true)
      const code = errorCode(e)
      setMessage(
        code === 'places_unavailable'
          ? 'Address lookup isn’t set up.'
          : code === 'places_failed'
            ? 'Couldn’t look that up. Try again later.'
            : e instanceof GeolocationPositionError
              ? e.code === e.PERMISSION_DENIED
                ? 'Location access is blocked for this site. Allow it in the browser settings.'
                : 'Couldn’t get your location. Try again.'
              : 'Couldn’t do that. Try again.',
      )
    } finally {
      setBusy(null)
    }
  }

  const keyMissing = errorCode(search.error) === 'places_unavailable'

  const pickSuggestion = (placeId: string) =>
    void run(placeId, () =>
      api(`/places/details?id=${encodeURIComponent(placeId)}&session=${session}`, {
        schema: LocationSchema,
      }),
    )

  return (
    // Up/Down walk the rows (data-row): current location, photo spots, the search box, then the
    // recent places or the results. `contents` keeps the dialog body's own layout.
    <div className="contents" onKeyDown={(e) => moveFocus(e, '[data-row]')}>
      {value && (
        <div className="flex flex-col gap-2 rounded-lg bg-surface-container-low py-2 pr-2 pl-3">
          <div className="flex items-center gap-2">
            <Icon name="location_on" className="size-5 shrink-0 text-on-surface-variant" />
            <span className="min-w-0 flex-1 truncate">{locationLabel(value)}</span>
            <Button variant="text" size="sm" onClick={() => onApply(null)}>
              Remove
            </Button>
          </div>
          <PlaceNameField
            initial={value.placeName ?? ''}
            action="Save name"
            onSubmit={(name) => onApply({ ...value, placeName: name })}
          />
        </div>
      )}

      <div className="flex flex-col gap-1">
        <button
          type="button"
          className={row}
          data-row=""
          disabled={!!busy}
          onClick={() =>
            void run('here', async () => {
              const pos = await currentPosition()
              setCoordsOnly(bareLocation(pos.coords.latitude, pos.coords.longitude))
              return describePoint(pos.coords.latitude, pos.coords.longitude)
            })
          }
        >
          {busy === 'here' ? (
            <Spinner />
          ) : (
            <Icon name="my_location" className="size-5 text-primary" />
          )}
          {busy === 'here' ? 'Finding your location…' : 'Use current location'}
        </button>
        {photoSpots.map((s) => (
          <button
            key={`${s.lat},${s.lng}`}
            type="button"
            className={row}
            data-row=""
            disabled={!!busy}
            onClick={() =>
              void run(`photo${s.n}`, () => {
                setCoordsOnly(bareLocation(s.lat, s.lng))
                return describePoint(s.lat, s.lng)
              })
            }
          >
            {busy === `photo${s.n}` ? (
              <Spinner />
            ) : (
              <Icon name="photo_camera" className="size-5 text-primary" />
            )}
            Use the location of photo {s.n}
          </button>
        ))}
      </div>

      {down ? (
        <OfflineNote className="px-3">Reconnect to search for places.</OfflineNote>
      ) : (
        <input
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          // The dialog sits inside the editor's form: Enter here must not submit (Save) it. It takes
          // the first result instead, once there is one.
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            const first = debounced === text.trim() ? search.data?.suggestions[0] : undefined
            if (first && !busy) pickSuggestion(first.placeId)
          }}
          placeholder="Search for a place"
          aria-label="Search for a place"
          data-row=""
          // Not on a touch screen, where it would raise the keyboard over the recent places.
          data-autofocus={autofocusWithMouse()}
          className="h-12 w-full rounded-sm border border-input bg-transparent px-4 text-base outline-none placeholder:text-on-surface-variant focus-visible:border-primary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
        />
      )}

      {(down || debounced.length < 2) && recent.data && recent.data.places.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="px-3 text-xs tracking-wide text-on-surface-variant uppercase">Recent</p>
          <ul className="-mx-2 flex flex-col">
            {recent.data.places.map((p) => (
              <li key={p.googlePlaceId ?? `${p.latitude},${p.longitude}`}>
                <button
                  type="button"
                  className={row}
                  data-row=""
                  disabled={!!busy}
                  onClick={() => onApply(p)}
                >
                  <Icon name="location_on" className="size-5 shrink-0 text-on-surface-variant" />
                  <span className="min-w-0">
                    <span className="block truncate">{p.placeName ?? p.locality}</span>
                    <span className="block truncate text-sm text-on-surface-variant">
                      {[p.placeName ? p.locality : null, p.region].filter(Boolean).join(', ')}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {keyMissing && (
        <p className="text-sm text-on-surface-variant">
          Place search isn’t set up.{' '}
          {admin ? (
            <>
              <Link to="/settings" className="text-primary underline" onClick={onClose}>
                Add a Google API key in Settings
              </Link>
              .
            </>
          ) : (
            'Ask an admin.'
          )}
        </p>
      )}
      {search.isError && !keyMissing && !down && (
        <p role="alert" className="text-sm text-error">
          Couldn’t search places right now.
        </p>
      )}
      {!down && search.data && search.data.suggestions.length === 0 && (
        <p className="text-sm text-on-surface-variant">No places found.</p>
      )}
      {!down && search.data && search.data.suggestions.length > 0 && (
        <ul className="-mx-2 flex flex-col">
          {search.data.suggestions.map((s) => (
            <li key={s.placeId}>
              <button
                type="button"
                className={row}
                data-row=""
                disabled={!!busy}
                onClick={() => pickSuggestion(s.placeId)}
              >
                <Icon name="location_on" className="size-5 shrink-0 text-on-surface-variant" />
                <span className="min-w-0">
                  <span className="block truncate">{s.name}</span>
                  <span className="block truncate text-sm text-on-surface-variant">{s.detail}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {message && (
        <p role="alert" className="text-sm text-error">
          {message}
        </p>
      )}
      {lookupOffline && (
        <OfflineNote className="px-3">
          {coordsOnly
            ? 'Can’t look up the address offline. You can save the coordinates instead.'
            : 'Reconnect to look that up.'}
        </OfflineNote>
      )}
      {(message || lookupOffline) && coordsOnly && (
        // No address to be had: the spot can still be named by hand.
        <PlaceNameField
          initial=""
          action="Save coordinates only"
          alwaysEnabled
          onSubmit={(name) => onApply({ ...coordsOnly, placeName: name })}
        />
      )}
      <DialogActions>
        <Button variant="text" onClick={onClose}>
          Cancel
        </Button>
      </DialogActions>
    </div>
  )
}
