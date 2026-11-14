import type { Location } from '@cairn/shared'
import { expect, test } from './helpers/test.ts'
import { entriesPane, entryPane } from './helpers/ui.ts'

const place = (placeName: string, latitude: number, longitude: number): Location => ({
  latitude,
  longitude,
  placeName,
  locality: null,
  region: null,
  country: null,
  address: null,
  googlePlaceId: null,
})

test('entries with a place show as pins; a pin opens its entry', async ({ page, api, journal }) => {
  // No requests to OpenStreetMap from tests: the map works without its tiles.
  await page.route('https://tile.openstreetmap.org/**', (route) => route.abort())
  await api.createEntry({
    journalId: journal.id,
    bodyMd: '# Coffee downtown',
    location: place('Union Station', 39.7527, -105.0002),
  })
  await api.createEntry({
    journalId: journal.id,
    bodyMd: '# Far away',
    location: place('Shibuya', 35.658, 139.7016),
  })
  await api.createEntry({ journalId: journal.id, bodyMd: '# Nowhere in particular' })

  await page.goto(`/j/${journal.id}`)
  await page.getByRole('radio', { name: 'Map' }).click()
  await expect(entriesPane(page)).toContainText('2 of 3 entries have a place')

  // It opens on the densest neighbourhood (both pins are a world apart), with a way out.
  const map = page.getByRole('region', { name: 'Map of entries' })
  const showAll = page.getByRole('button', { name: 'Show all' })
  await expect(showAll).toBeVisible()
  await showAll.click()
  await expect(showAll).toBeHidden()
  await expect(map.getByRole('button', { name: 'Far away' })).toBeVisible()

  await map.getByRole('button', { name: 'Coffee downtown' }).click()
  await expect(map).toContainText('Union Station')
  await map.getByRole('button', { name: 'Open entry' }).click()
  await expect(entryPane(page).getByRole('heading', { name: 'Coffee downtown' })).toBeVisible()

  // The view is a per-device choice, not part of the URL: it holds after a reload.
  await page.goto(`/j/${journal.id}`)
  await expect(page.getByRole('radio', { name: 'Map' })).toBeChecked()
})
