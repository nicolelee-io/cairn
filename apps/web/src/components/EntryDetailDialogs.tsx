import type { ReactNode } from 'react'
import type { Location, Weather, WeatherSource } from '@cairn/shared'
import { copyText } from '../lib/clipboard.ts'
import { formatTemp } from '../lib/format.ts'
import { locationLabel } from '../lib/location.ts'
import { useTempUnit } from '../lib/tempUnit.ts'
import { showToast } from '../lib/toast.ts'
import { weatherIcon, weatherLabel } from '../lib/weather.ts'
import { Icon } from './Icon.tsx'
import { Button, buttonVariants } from './ui/button.tsx'
import { Dialog } from './ui/dialog.tsx'

/** A label over its value; `dd`s are selectable so a coordinate or an address can be copied by hand. */
function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs tracking-wide text-on-surface-variant uppercase">{label}</dt>
      <dd className="select-text">{children}</dd>
    </div>
  )
}

const link = buttonVariants({ variant: 'tonal' })

/**
 * Everything an entry knows about its place, read-only, from the reader's place chip: the chip
 * itself truncates a long name, and the address parts and coordinates have nowhere else to show.
 * Opens the spot in another map app (a plain link out, nothing is sent until it is tapped).
 */
export function PlaceDetailDialog({
  place,
  open,
  onClose,
}: {
  place: Location
  open: boolean
  onClose: () => void
}) {
  const { latitude: lat, longitude: lng } = place
  const coordinates = `${lat.toFixed(5)}, ${lng.toFixed(5)}`
  // The full address already names the town; without one, build it from the parts.
  const area = [place.locality, place.region, place.country].filter(Boolean).join(', ')
  return (
    <Dialog open={open} onClose={onClose} title="Place" showClose>
      <p className="flex items-start gap-2 text-lg">
        <Icon name="location_on" filled className="mt-0.5 size-6 shrink-0 text-tertiary" />
        <span className="min-w-0 select-text [overflow-wrap:anywhere]">
          {place.placeName ?? locationLabel(place)}
        </span>
      </p>
      <dl className="flex flex-col gap-3">
        {place.address ? (
          <Detail label="Address">{place.address}</Detail>
        ) : (
          area && <Detail label="Area">{area}</Detail>
        )}
        <Detail label="Coordinates">{coordinates}</Detail>
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="tonal"
          onClick={() =>
            void copyText(coordinates).then((ok) =>
              showToast(ok ? 'Coordinates copied' : 'Couldn’t copy'),
            )
          }
        >
          <Icon name="content_copy" className="size-5" />
          Copy coordinates
        </Button>
        <a
          href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`}
          target="_blank"
          rel="noopener noreferrer"
          className={link}
        >
          <Icon name="open_in_new" className="size-5" />
          OpenStreetMap
        </a>
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`}
          target="_blank"
          rel="noopener noreferrer"
          className={link}
        >
          <Icon name="open_in_new" className="size-5" />
          Google Maps
        </a>
      </div>
    </Dialog>
  )
}

const SOURCE: Record<WeatherSource, string> = {
  dayone: 'Day One',
  google: 'Google Weather',
  'open-meteo': 'Open-Meteo',
  manual: 'Entered by hand',
}

/** The entry's weather in full, read-only, from the reader's weather chip. */
export function WeatherDetailDialog({
  weather,
  open,
  onClose,
}: {
  weather: Weather
  open: boolean
  onClose: () => void
}) {
  const unit = useTempUnit()
  // Wind is stored in km/h; a Fahrenheit account gets miles per hour with it.
  const wind =
    weather.windKph === null
      ? null
      : unit === 'F'
        ? `${Math.round(weather.windKph / 1.609344)} mph`
        : `${Math.round(weather.windKph)} km/h`
  return (
    <Dialog open={open} onClose={onClose} title="Weather" showClose>
      <p className="flex items-center gap-2 text-lg">
        <Icon
          name={weatherIcon(weather.condition, weather.isDay)}
          className="size-6 text-tertiary"
        />
        <span>
          {weather.tempC === null
            ? weatherLabel(weather.condition)
            : `${formatTemp(weather.tempC)} ${weatherLabel(weather.condition)}`}
        </span>
      </p>
      <dl className="flex flex-col gap-3">
        {weather.description && <Detail label="Conditions">{weather.description}</Detail>}
        {weather.humidityPct !== null && (
          <Detail label="Humidity">{Math.round(weather.humidityPct)}%</Detail>
        )}
        {wind && <Detail label="Wind">{wind}</Detail>}
        {weather.pressureMb !== null && (
          <Detail label="Pressure">{Math.round(weather.pressureMb)} hPa</Detail>
        )}
        <Detail label="Source">{SOURCE[weather.source]}</Detail>
      </dl>
    </Dialog>
  )
}
