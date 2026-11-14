import { expect, isPhone, test } from './helpers/test.ts'
import { entriesPane, entryPane } from './helpers/ui.ts'

// Entries show in their own timezone, never the viewer's. The browser here is in New York; the
// entry was written in Tokyo at 12:30 PM on Thu 15 Jan 2026 (Wed 14 Jan, 10:30 PM in New York).
test.use({ timezoneId: 'America/New_York' })

test("an entry shows its own timezone's date and time", async ({ page, api, journal }, info) => {
  const { entry } = await api.createEntry({
    journalId: journal.id,
    bodyMd: '# Lunch in Shibuya',
    createdAt: Date.UTC(2026, 0, 15, 3, 30),
    timezone: 'Asia/Tokyo',
  })

  await page.goto(`/j/${journal.id}`)
  const month = entriesPane(page).getByRole('region', { name: 'January 2026' })
  await expect(month).toContainText(/Thu\s*15/)
  const card = month.getByRole('link', { name: /Lunch in Shibuya/ })
  await expect(card).toContainText('12:30 PM')
  await expect(card).not.toContainText('10:30 PM')

  await page.goto(`/j/${journal.id}/entry/${entry.id}`)
  const reader = entryPane(page).getByRole('article')
  await expect(reader).toContainText(
    isPhone(info.project.name)
      ? 'Jan 15, 2026 · 12:30 PM'
      : 'Thursday, January 15, 2026 · 12:30 PM',
  )
})
