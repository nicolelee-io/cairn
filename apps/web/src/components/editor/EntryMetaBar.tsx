import { useQuery } from '@tanstack/react-query'
import { WeatherSchema, type Journal } from '@cairn/shared'
import { api, errorCode } from '../../lib/api.ts'
import { type DraftFields } from '../../lib/draft.ts'
import { locationLabel } from '../../lib/location.ts'
import { journalById, keys } from '../../lib/queries.ts'
import { Icon } from '../Icon.tsx'
import { EntryWhen, MetaChip } from '../MetaChip.tsx'
import { Select } from '../ui/select.tsx'
import { WeatherChip } from '../WeatherChip.tsx'

/**
 * What the entry is about: which journal, when, where, the weather and tags. Each is a chip that
 * opens its own editor (the dialogs live in `EntryEditor`, which also opens them from shortcuts).
 * They sit under the text so the first line stays the entry's title; the mood is up in the header
 * with star and pin.
 */
export function EntryMetaBar({
  fields,
  journals,
  locating,
  onJournal,
  onDone,
  onDate,
  onPlace,
  onWeather,
  onTags,
}: {
  fields: DraftFields
  /** Active journals only. */
  journals: Journal[]
  /** The place is being looked up (the auto-location setting). */
  locating: boolean
  onJournal: (journalId: string) => void
  /** Hands focus back to the text after a keyboard pick in the journal list. */
  onDone: () => void
  onDate: () => void
  onPlace: () => void
  onWeather: () => void
  onTags: () => void
}) {
  // The weather Google would give for the place and time, shown in the chip before Save (which
  // stores it, with every other field, on the server). Hourly buckets: minutes don't change it.
  const wantsAuto = !!fields.location && !!fields.weather && 'auto' in fields.weather
  const preview = useQuery({
    queryKey: keys.weatherPreview(
      fields.location?.latitude,
      fields.location?.longitude,
      Math.floor(fields.createdAt / 600_000),
    ),
    queryFn: () =>
      api(
        `/weather/preview?lat=${fields.location!.latitude}&lng=${fields.location!.longitude}&at=${fields.createdAt}`,
        { schema: WeatherSchema },
      ),
    enabled: wantsAuto,
    retry: false,
    staleTime: 5 * 60_000,
  })
  const journal = journalById(journals, fields.journalId)

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-outline-variant py-3">
      <Select
        label="Journal"
        value={fields.journalId}
        onChange={onJournal}
        options={[
          ...journals.map((j) => ({ value: j.id, label: j.name, dot: j.color ?? '' })),
          ...(journal ? [] : [{ value: fields.journalId, label: 'Unavailable journal', dot: '' }]),
        ]}
        className="min-w-0 max-w-full"
        onDone={onDone}
        // Opens upward: it is at the bottom of the screen.
        above
      />
      <MetaChip icon="calendar_month" onClick={onDate}>
        <EntryWhen {...fields} />
      </MetaChip>
      <MetaChip
        icon="location_on"
        active={!!fields.location}
        label={fields.location ? `Place: ${locationLabel(fields.location)}` : 'Add place'}
        onClick={onPlace}
      >
        <span className="truncate">
          {fields.location
            ? locationLabel(fields.location)
            : locating
              ? 'Finding location…'
              : 'Add place'}
        </span>
      </MetaChip>
      <MetaChip label="Weather" onClick={onWeather}>
        {fields.weather && !('auto' in fields.weather) ? (
          <WeatherChip
            condition={fields.weather.condition}
            isDay={fields.weather.isDay}
            tempC={fields.weather.tempC}
            plain
          />
        ) : wantsAuto && preview.data ? (
          <WeatherChip
            condition={preview.data.condition}
            isDay={preview.data.isDay}
            tempC={preview.data.tempC}
            plain
          />
        ) : (
          <>
            <Icon name="cloud" className="size-5 shrink-0 text-on-surface-variant" />
            <span className="truncate">
              {fields.weather
                ? wantsAuto && preview.isFetching
                  ? 'Finding weather…'
                  : wantsAuto && preview.isError
                    ? errorCode(preview.error) === 'no_weather'
                      ? 'No weather for this time'
                      : 'Weather unavailable'
                    : 'Weather: automatic'
                : 'Add weather'}
            </span>
          </>
        )}
      </MetaChip>
      <MetaChip
        icon="sell"
        active={fields.tags.length > 0}
        label={fields.tags.length ? `Tags: ${fields.tags.join(', ')}` : 'Add tags'}
        onClick={onTags}
      >
        <span className="truncate">{fields.tags.length ? fields.tags.join(', ') : 'Add tags'}</span>
      </MetaChip>
    </div>
  )
}
