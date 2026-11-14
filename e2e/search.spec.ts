import { expect, test } from './helpers/test.ts'
import { entryPane } from './helpers/ui.ts'

// Other tests write to the same database, so every word searched for here is unique to this test.
const unique = () => `zq${Math.random().toString(36).slice(2, 8)}`

test('find an entry by a word and open it', async ({ page, api, journal }) => {
  const word = unique()
  await api.createEntry({
    journalId: journal.id,
    bodyMd: `# Heron sighting\n\nA ${word} by the river`,
  })
  await api.createEntry({ journalId: journal.id, bodyMd: '# Unrelated\n\nNothing to see' })

  await page.goto('/search')
  await page.getByRole('searchbox', { name: 'Search entries' }).fill(word)
  const results = page.getByRole('list', { name: 'Results' }).getByRole('listitem')
  await expect(results).toHaveCount(1)
  await expect(results.locator('mark')).toHaveText(word)

  await results.getByRole('link').click()
  await expect(entryPane(page).getByRole('heading', { name: 'Heron sighting' })).toBeVisible()
})

test('Starred with no words lists the starred entries', async ({ page, api, journal }) => {
  const starred = `Starred ${unique()}`
  const plain = `Plain ${unique()}`
  await api.createEntry({ journalId: journal.id, bodyMd: `# ${starred}`, starred: true })
  await api.createEntry({ journalId: journal.id, bodyMd: `# ${plain}` })

  await page.goto('/search')
  await page.getByRole('button', { name: 'Starred' }).click()
  const results = page.getByRole('list', { name: 'Results' })
  await expect(results.getByText(starred)).toBeVisible()
  await expect(results.getByText(plain)).toBeHidden()
})

test('filter by mood and by a date range', async ({ page, api, journal }) => {
  const word = unique()
  const make = (day: string, mood: 'happy' | 'sad') =>
    api.createEntry({
      journalId: journal.id,
      bodyMd: `# ${mood} ${day} ${word}`,
      mood,
      timezone: 'America/Denver',
      createdAt: Date.parse(`${day}T18:00:00Z`),
    })
  await make('2026-02-10', 'happy')
  await make('2026-02-20', 'sad')

  await page.goto(`/search?q=${word}`)
  const results = page.getByRole('list', { name: 'Results' }).getByRole('listitem')
  await expect(results).toHaveCount(2)

  // The rarer filters sit behind "More filters".
  await expect(page.getByRole('button', { name: 'Mood' })).toBeHidden()
  await page.getByRole('button', { name: 'More filters' }).click()
  await page.getByRole('button', { name: 'Mood' }).click()
  await page.getByRole('option', { name: /Happy/ }).click()
  await expect(results).toHaveCount(1)
  await expect(results.first()).toContainText('happy 2026-02-10')

  // A date in the URL opens the section; the chip names the day, and its X clears it.
  await page.goto(`/search?q=${word}&from=2026-02-15&to=2026-02-25`)
  await expect(results).toHaveCount(1)
  await expect(results.first()).toContainText('sad 2026-02-20')
  await expect(page.getByRole('button', { name: 'From date: Feb 15, 2026' })).toBeVisible()

  // Picking a day in the themed calendar sets the other end.
  await page.getByRole('button', { name: 'To date: Feb 25, 2026' }).click()
  const dialog = page.getByRole('dialog', { name: 'To date' })
  await dialog.getByRole('button', { name: '2026-02-18' }).click()
  await expect(page.getByText('No entries match')).toBeVisible()

  // Or type the day: a bad one is flagged, a good one applies on Enter.
  await page.getByRole('button', { name: 'To date: Feb 18, 2026' }).click()
  const typed = page.getByRole('dialog', { name: 'To date' }).getByLabel('Type a date')
  await typed.fill('2/31/2026')
  await typed.blur()
  await expect(page.getByRole('status')).toContainText('isn’t a date')
  await typed.fill('02/25/2026')
  await typed.press('Enter')
  await expect(page.getByRole('button', { name: 'To date: Feb 25, 2026' })).toBeVisible()
  await expect(results).toHaveCount(1)
  await expect(results.first()).toContainText('sad 2026-02-20')

  await page.getByRole('button', { name: 'Clear from date' }).click()
  await expect(results).toHaveCount(2)
})
