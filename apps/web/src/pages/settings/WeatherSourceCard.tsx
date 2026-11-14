import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { WeatherSettingsSchema, type WeatherProvider } from '@cairn/shared'
import { Select } from '../../components/ui/select.tsx'
import { api, errorCode } from '../../lib/api.ts'
import { keys } from '../../lib/queries.ts'

/** Server-wide: where automatic weather comes from, Open-Meteo or Google (admins only). */
export function WeatherSourceCard() {
  const qc = useQueryClient()
  const current = useQuery({
    queryKey: keys.adminWeather,
    queryFn: () => api('/admin/weather', { schema: WeatherSettingsSchema }),
  }).data
  const save = useMutation({
    mutationFn: (provider: WeatherProvider) =>
      api('/admin/weather', { method: 'PUT', body: { provider }, schema: WeatherSettingsSchema }),
    onSuccess: (s) => qc.setQueryData(keys.adminWeather, s),
  })
  if (!current) return null
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-surface-container-low p-4">
      <div className="flex flex-wrap items-center gap-4">
        <p className="flex-1 text-lg">Weather source</p>
        <Select
          label="Weather source"
          value={current.provider}
          options={[
            { value: 'open-meteo', label: 'Open-Meteo' },
            { value: 'google', label: 'Google (last 24 hours only)' },
          ]}
          onChange={(v) => save.mutate(v as WeatherProvider)}
        />
      </div>
      <p className="text-sm text-on-surface-variant">
        Where entries with a place get their weather. Open-Meteo is free, needs no key and has
        history for any date, so it is the recommended choice. Weather already on entries stays as
        it is.
      </p>
      {current.provider === 'google' && (
        <div
          role="note"
          className="flex flex-col gap-1 rounded-lg bg-error-container px-4 py-3 text-sm text-on-error-container"
        >
          <p className="font-medium">Google only has weather for the last 24 hours.</p>
          <p>
            An entry dated earlier than that (written for a past day, edited later, or given a place
            after the first day) gets no weather at all. It also uses the Google key above
            {current.googleConfigured ? '' : ' (none saved yet, so no weather is added)'}, and
            Google may bill for those requests. Switch back to Open-Meteo unless you need Google.
          </p>
        </div>
      )}
      {save.isError && (
        <p role="alert" className="text-sm text-error">
          {errorCode(save.error) === 'google_key_needed'
            ? 'Save a Google key first.'
            : 'Couldn’t save the setting.'}
        </p>
      )}
    </div>
  )
}
