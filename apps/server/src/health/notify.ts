import {
  DEFAULT_NTFY_URL,
  type NotifySettings,
  type NotifyTestResult,
  type UpdateNotifySettings,
} from '@cairn/shared'
import type { Db } from '../db/index.ts'
import { appSettingsRepo } from '../repo/appSettings.ts'

const ENABLED = 'ntfy_enabled'
const URL_KEY = 'ntfy_url'
const TOPIC = 'ntfy_topic'
const TOKEN = 'ntfy_token'

export interface Alert {
  /** ASCII only: it travels in an HTTP header. */
  title: string
  message: string
  /** ntfy priority, 1 (min) to 5 (max). */
  priority?: number
  /** ntfy emoji shortcodes shown beside the title. */
  tags?: string[]
}

/** The admin's ntfy settings, kept in app_setting. The token is write-only from the outside. */
export function notifySettings(db: Db) {
  const store = appSettingsRepo(db)
  const read = () => ({
    enabled: store.get(ENABLED) === '1',
    url: (store.get(URL_KEY) || DEFAULT_NTFY_URL).replace(/\/+$/, ''),
    topic: store.get(TOPIC) ?? '',
    token: store.get(TOKEN) ?? '',
  })
  return {
    read,
    view(): NotifySettings {
      const { token, ...rest } = read()
      return { ...rest, hasToken: token !== '' }
    },
    save(s: UpdateNotifySettings) {
      store.set(ENABLED, s.enabled ? '1' : '0')
      store.set(URL_KEY, s.url.replace(/\/+$/, ''))
      store.set(TOPIC, s.topic)
      if (s.token === '') store.delete(TOKEN)
      else if (s.token !== undefined) store.set(TOKEN, s.token)
    },
  }
}

/**
 * Pushes one message to the configured ntfy topic. Never throws: a notifier that fails must not
 * take the health check, or anything else, down with it. The token is never put in the error.
 */
export async function sendAlert(
  config: { url: string; topic: string; token: string },
  alert: Alert,
  fetchImpl: typeof fetch = fetch,
): Promise<NotifyTestResult> {
  if (!config.topic) return { ok: false, error: 'No topic set' }
  const headers: Record<string, string> = { Title: alert.title }
  if (alert.priority) headers.Priority = String(alert.priority)
  if (alert.tags?.length) headers.Tags = alert.tags.join(',')
  if (config.token) headers.Authorization = `Bearer ${config.token}`
  try {
    const res = await fetchImpl(`${config.url}/${encodeURIComponent(config.topic)}`, {
      method: 'POST',
      headers,
      body: alert.message,
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
    return res.ok ? { ok: true, error: null } : { ok: false, error: `ntfy answered ${res.status}` }
  } catch (e) {
    const timedOut = e instanceof Error && e.name === 'TimeoutError'
    return { ok: false, error: timedOut ? 'ntfy did not answer in time' : 'Could not reach ntfy' }
  }
}
