import { resolve } from 'node:path'
import { parseTrustProxy, type TrustProxy } from './auth/clientIp.ts'

export interface InitialUser {
  username: string
  password: string
  displayName: string
  timezone: string
}

export interface Config {
  port: number
  sha: string
  /** ISO build time from BUILD_DATE; unset in dev. */
  builtAt?: string
  webDist?: string
  dataDir: string
  migrationsDir: string
  initialUser?: InitialUser
  /** Google Places/Geocoding/Weather key; place search and weather are off without it. */
  googleApiKey?: string
  /** TRUST_PROXY: the reverse proxies whose X-Forwarded-For names the client (login limits). */
  trustProxy?: TrustProxy
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const username = env.INITIAL_USERNAME?.trim()
  const password = env.INITIAL_PASSWORD
  return {
    port: Number(env.PORT ?? 3000),
    sha: env.GIT_SHA ?? 'dev',
    builtAt: env.BUILD_DATE || undefined,
    webDist: env.WEB_DIST,
    // Dev default is <repo>/data-dev (git-ignored); the image sets DATA_DIR=/data.
    dataDir: env.DATA_DIR ?? resolve(import.meta.dirname, '../../../data-dev'),
    // Dev default resolves from src/; the bundled image sets MIGRATIONS_DIR.
    migrationsDir: env.MIGRATIONS_DIR ?? resolve(import.meta.dirname, '../drizzle'),
    googleApiKey: env.GOOGLE_API_KEY?.trim() || undefined,
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    initialUser:
      username && password
        ? {
            username,
            password,
            displayName: env.INITIAL_DISPLAY_NAME?.trim() || username,
            timezone: env.INITIAL_TIMEZONE?.trim() || 'UTC',
          }
        : undefined,
  }
}
