import { expect, test } from './helpers/test.ts'
import { E2E_TIMEZONE } from './env.ts'
import { entriesPane } from './helpers/ui.ts'

/** Noon, on today's date in the account's timezone, `years` years ago. */
function yearsAgoNoon(years: number) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: E2E_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(Date.now())
  const [y, m, d] = parts.split('-').map(Number) as [number, number, number]
  // Denver is UTC-6 or UTC-7: 19:00 UTC is midday there all year.
  return Date.UTC(y - years, m - 1, d, 19)
}

test.describe('On this day opens entries', () => {
  test('in a popup on desktop: Back and Esc close it, the page stays put', async ({
    page,
    api,
    journal,
    isMobile,
  }) => {
    test.skip(isMobile, 'phones open the entry full screen')
    const word = `otdPopup${Date.now() % 100000}`
    const entry = await api.createEntry({
      journalId: journal.id,
      bodyMd: `# ${word}\n\nA year ago today.\n\n${'A long paragraph of filler text.\n\n'.repeat(60)}The very end.`,
      createdAt: yearsAgoNoon(1),
    })
    await page.goto('/insights')
    await page.getByRole('link', { name: new RegExp(word) }).click()

    const popup = page.getByRole('dialog', { name: 'Entry' })
    await expect(popup).toContainText('A year ago today.')
    await expect(page).toHaveURL(/\/insights$/)

    // The header (Close, Pin, Edit...) stays put while the text scrolls.
    await popup.getByText('The very end.').scrollIntoViewIfNeeded()
    await expect(popup.getByRole('button', { name: 'Pin' })).toBeInViewport()

    await page.goBack() // the browser's and Android's Back
    await expect(popup).toBeHidden()
    await expect(page).toHaveURL(/\/insights$/)

    await page.getByRole('link', { name: new RegExp(word) }).click()
    await expect(popup).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(popup).toBeHidden()
    await expect(page).toHaveURL(/\/insights$/)

    // Edit leaves the page for the editor.
    await page.getByRole('link', { name: new RegExp(word) }).click()
    await popup.getByRole('link', { name: 'Edit', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/entry/${entry.entry.id}/edit$`))
  })

  test('as the full-screen reader on a phone', async ({ page, api, journal, isMobile }) => {
    test.skip(!isMobile, 'desktop opens a popup')
    const word = `otdPhone${Date.now() % 100000}`
    const entry = await api.createEntry({
      journalId: journal.id,
      bodyMd: `# ${word}\n\nA year ago today.`,
      createdAt: yearsAgoNoon(1),
    })
    await page.goto('/insights')
    await page.getByRole('link', { name: new RegExp(word) }).click()
    await expect(page).toHaveURL(new RegExp(`/entry/${entry.entry.id}$`))
    await expect(page.getByRole('dialog')).toBeHidden()
  })

  test('Edit from the popup lists the entry’s journal, scrolled to it', async ({
    page,
    api,
    journal,
    isMobile,
  }) => {
    test.skip(isMobile, 'phones have no list beside the editor')
    const word = `otdScroll${Date.now() % 100000}`
    // Newer entries fill the first page (30), so the old one has to be loaded and scrolled to. All of
    // them are years back, behind every other test's entries in the shared All Entries list.
    for (let i = 0; i < 40; i++) {
      await api.createEntry({
        journalId: journal.id,
        bodyMd: `# Filler ${i}`,
        createdAt: yearsAgoNoon(2) - (i + 2) * 86_400_000,
      })
    }
    const entry = await api.createEntry({
      journalId: journal.id,
      bodyMd: `# ${word}\n\nA year ago today.`,
      createdAt: yearsAgoNoon(3),
    })
    await page.goto('/insights')
    await page.getByRole('link', { name: new RegExp(word) }).click()
    await page
      .getByRole('dialog', { name: 'Entry' })
      .getByRole('link', { name: 'Edit', exact: true })
      .click()

    await expect(page).toHaveURL(new RegExp(`/j/${journal.id}/entry/${entry.entry.id}/edit$`))
    const card = entriesPane(page).getByRole('link', { name: new RegExp(word) })
    await expect(card).toBeInViewport()
    await expect(card).toHaveAttribute('aria-current', 'page')

    // A reload (or any deep link) finds it the same way.
    await page.reload()
    await expect(card).toBeInViewport()
  })
})
