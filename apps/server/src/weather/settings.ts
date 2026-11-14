import { WeatherProviderSchema, type WeatherProvider } from '@cairn/shared'
import type { Db } from '../db/index.ts'
import { appSettingsRepo } from '../repo/appSettings.ts'

const KEY = 'weather_provider'

/** The admin's choice of where automatic weather comes from; Open-Meteo until one is made. */
export function weatherSetting(db: Db) {
  const store = appSettingsRepo(db)
  return {
    get(): WeatherProvider {
      const saved = WeatherProviderSchema.safeParse(store.get(KEY))
      return saved.success ? saved.data : 'open-meteo'
    },
    set: (provider: WeatherProvider) => store.set(KEY, provider),
  }
}
