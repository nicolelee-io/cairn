// Cutting the app off from the server. `setOffline` alone is not enough: Chromium's offline
// emulation doesn't apply to the service worker's own fetches, so its network-first reads would
// still reach the server. Aborting at the context level catches those too.
import type { BrowserContext, Page, Route } from '@playwright/test'
import { BASE_URL } from '../env.ts'

const everything = `${BASE_URL}/**`
const abort = (route: Route) => route.abort('internetdisconnected')

export async function goOffline(context: BrowserContext) {
  await context.setOffline(true)
  await context.route(everything, abort)
}

export async function goOnline(context: BrowserContext) {
  await context.unroute(everything, abort)
  await context.setOffline(false)
}

/** True when nothing reaches the server (a probe that no cache answers). */
export const serverUnreachable = (page: Page) =>
  page.evaluate(() =>
    fetch('/api/health', { cache: 'no-store' }).then(
      () => false,
      () => true,
    ),
  )

/** Waits until the service worker controls the page (it registers in production builds only). */
export async function waitForServiceWorker(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) {
      await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r))
    }
  })
}
