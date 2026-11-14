import { expect, test } from './helpers/test.ts'
import type { Location } from '@cairn/shared'
import { entriesPane, entryPane, typeInEditor } from './helpers/ui.ts'

// Keyboard shortcuts (lib/shortcuts.ts). A phone has no keyboard to speak of, so desktop only.
test.skip(({ isMobile }) => isMobile, 'keyboard shortcuts are for a physical keyboard')

test('a keyboard-only session: browse, flip through entries, edit, save, palette', async ({
  page,
  api,
  journal,
}) => {
  const base = Date.now() - 10 * 86_400_000
  for (const [i, word] of ['kbdAlpha', 'kbdBravo', 'kbdCharlie'].entries()) {
    await api.createEntry({
      journalId: journal.id,
      bodyMd: `# ${word}\n\nText of ${word}.`,
      createdAt: base + i * 86_400_000,
    })
  }
  // The g chords are off until Settings turns them on.
  await page.addInitScript(() => localStorage.setItem('cairn:goto-shortcuts', 'on'))
  await page.goto(`/j/${journal.id}`)
  await page.evaluate(() => localStorage.setItem('cairn:browse-view', 'list'))
  await page.reload()
  await expect(entriesPane(page).getByRole('link', { name: /kbdCharlie/ })).toBeVisible()

  // The help dialog lists what applies here, and Esc closes it.
  await page.keyboard.press('?')
  const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(help).toContainText('Next journal')
  await page.keyboard.press('Escape')
  await expect(help).toBeHidden()

  // j walks the cards; Enter opens the focused one. Newest first: Charlie, Bravo, Alpha.
  await page.keyboard.press('j')
  await expect(entriesPane(page).getByRole('link', { name: /kbdCharlie/ })).toBeFocused()
  await page.keyboard.press('Enter')
  const reader = entryPane(page).getByRole('article')
  await expect(reader.getByRole('heading', { name: 'kbdCharlie' })).toBeVisible()

  // j is the older entry, k the newer one, and neither stacks history.
  await page.keyboard.press('j')
  await expect(reader.getByRole('heading', { name: 'kbdBravo' })).toBeVisible()
  await page.keyboard.press('j')
  await expect(reader.getByRole('heading', { name: 'kbdAlpha' })).toBeVisible()
  await page.keyboard.press('k')
  await expect(reader.getByRole('heading', { name: 'kbdBravo' })).toBeVisible()

  // e edits; bare keys don't fire while typing; Mod+S saves.
  await page.keyboard.press('e')
  await expect(page).toHaveURL(/\/edit$/)
  await typeInEditor(page, '\n\nnpesj added by keyboard')
  // Mood: the shortcut opens the picker with focus inside; arrows move, Enter picks, and the caret
  // goes back to the text.
  await page.keyboard.press('Alt+Shift+M')
  const moods = page.getByRole('group', { name: 'Mood' })
  await expect(moods.getByRole('button', { name: 'Happy' })).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowDown')
  await expect(moods.getByRole('button', { name: 'Down' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Mood: Down' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Entry text' })).toBeFocused()

  // Link is Ctrl/Cmd+L; Ctrl/Cmd+K is the palette here too.
  await page.keyboard.press('ControlOrMeta+k')
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible()
  await page.keyboard.press('Escape')

  // Ctrl/Cmd+/ shows the shortcuts even from the editor, where a bare ? is just text.
  await page.keyboard.press('ControlOrMeta+/')
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toContainText('Bold')
  await page.keyboard.press('Escape')

  // Ctrl/Cmd+S saves and stays; Ctrl/Cmd+Shift+S saves and closes.
  await page.keyboard.press('ControlOrMeta+s')
  await expect(page.getByRole('button', { name: 'Save and close' })).toBeDisabled()
  await page.keyboard.press('ControlOrMeta+Shift+s')
  await expect(reader).toContainText('npesj added by keyboard')

  // Esc from the editor asks before dropping changes.
  await page.keyboard.press('e')
  await typeInEditor(page, ' more')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Leave the editor?' })).toBeVisible()
  // Focus starts on the main choice, so Enter alone would keep the draft.
  await expect(page.getByRole('button', { name: 'Keep draft' })).toBeFocused()
  await page.getByRole('button', { name: 'Keep editing' }).click()
  await page.keyboard.press('ControlOrMeta+Shift+s')
  await expect(reader).toContainText('more')

  // Chords and the palette.
  await page.keyboard.press('g')
  await page.keyboard.press('i')
  await expect(page).toHaveURL(/\/insights$/)
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await page.keyboard.type('manage tags')
  await expect(palette.getByRole('option', { name: /^Manage tags Go to/ })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/tags$/)

  // n starts a new entry.
  await page.goto(`/j/${journal.id}`)
  await expect(entriesPane(page).getByRole('link', { name: /kbdCharlie/ })).toBeVisible()
  await page.keyboard.press('n')
  await expect(page).toHaveURL(new RegExp(`/j/${journal.id}/new$`))
})

test('single-key shortcuts can be turned off, and typing never triggers them', async ({ page }) => {
  await page.goto('/search')
  // Typing in the search box: "n", "g" and "?" are text, not shortcuts.
  await page.getByRole('searchbox', { name: 'Search entries' }).fill('')
  await page.keyboard.type('ng?')
  await expect(page).toHaveURL(/\/search/)
  await expect(page.getByRole('searchbox', { name: 'Search entries' })).toHaveValue('ng?')

  await page.goto('/settings/keyboard')
  // The g chords start off, so g then t goes nowhere until the switch is on.
  await page.keyboard.press('g')
  await page.keyboard.press('t')
  await expect(page).toHaveURL(/\/settings\/keyboard$/)
  await page.getByRole('switch', { name: 'Use go-to keys' }).click()
  await page.keyboard.press('g')
  await expect(page.getByRole('status').filter({ hasText: 'Go to…' })).toBeVisible()
  await page.keyboard.press('t')
  await expect(page).toHaveURL(/\/tags$/)
  await page.goto('/settings/keyboard')
  await page.getByRole('switch', { name: 'Use go-to keys' }).click()

  await page.getByRole('switch', { name: 'Use quick-action keys' }).click()
  await page.keyboard.press('n')
  await expect(page).toHaveURL(/\/settings\/keyboard$/)
  // Ctrl/Cmd shortcuts still work.
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(palette).toBeVisible()
  // Keys that are switched off aren't shown as hints (the commands still run from the palette).
  await page.keyboard.type('manage tags')
  const tagsCommand = palette.getByRole('option', { name: /^Manage tags Go to/ })
  await expect(tagsCommand).toBeVisible()
  await expect(tagsCommand.locator('kbd')).toHaveCount(0)
  await page.keyboard.press('Escape')

  // While the quick-action keys are off the help doesn't list them; the Ctrl/Cmd ones stay.
  await page.getByRole('button', { name: /Keyboard shortcuts/ }).click()
  const offHelp = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(offHelp).not.toContainText('Older entry')
  await expect(offHelp).toContainText('Bold')
  await page.keyboard.press('Escape')
  await page.getByRole('switch', { name: 'Use quick-action keys' }).click()

  // Opened from Settings, the help lists everything (the reader's and editor's keys too).
  await page.getByRole('button', { name: /Keyboard shortcuts/ }).click()
  const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(help).toContainText('Older entry')
  // The go-to chords are off, so they aren't listed.
  await expect(help).not.toContainText('Manage tags')
  await expect(help).toContainText('Bold')
  // Ctrl/Cmd+Enter is a new line in the editor, not Save.
  await expect(help.getByRole('listitem').filter({ hasText: /^SaveCtrlS$/ })).toHaveCount(1)
  await expect(
    help.getByRole('listitem').filter({ hasText: 'Insert a blank line below' }),
  ).toContainText('Enter')
})

test('after following a link by keyboard, focus is on the new page and Tab continues from it', async ({
  page,
}) => {
  // Manage journals' own Trash link (the last one; the Settings list beside it has a row too, which
  // stays put and so would keep focus, as a side nav should).
  await page.goto('/journals')
  const links = page.getByRole('link', { name: /^Trash/ })
  // The page's link comes once its journal list has loaded.
  await expect(links).toHaveCount(2)
  await links.last().focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/trash$/)
  // The pressed link is gone; focus is the page's main region, not the top of the document.
  await expect(page.locator('main#main')).toBeFocused()
  await page.keyboard.press('Tab')
  expect(await page.evaluate(() => !!document.activeElement?.closest('main#main'))).toBe(true)
})

test('the Calendar: arrows walk the days with entries, Enter opens one', async ({
  page,
  api,
  journal,
}) => {
  const at = (iso: string) => Date.parse(iso)
  for (const [word, iso] of [
    ['calOne', '2026-03-04T15:00:00Z'],
    ['calTwo', '2026-03-09T15:00:00Z'],
    ['calThree', '2026-03-12T15:00:00Z'],
  ] as const)
    await api.createEntry({ journalId: journal.id, bodyMd: `# ${word}`, createdAt: at(iso) })

  await page.goto(`/j/${journal.id}`)
  await page.getByRole('radio', { name: 'Calendar', exact: true }).click()
  const march = page.getByRole('region', { name: /March 2026/ })
  // Months far from today only load their days once scrolled near.
  await march.scrollIntoViewIfNeeded()
  const days = march.locator('button[data-day]')
  await expect(days).toHaveCount(3)

  // The days are buttons, so Tab reaches them; the arrows then step between days with entries.
  await days.first().focus()
  await page.keyboard.press('ArrowRight')
  await expect(days.nth(1)).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(days.nth(2)).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(days.nth(1)).toBeFocused()

  await page.keyboard.press('Enter')
  await expect(entryPane(page).getByRole('heading', { name: 'calTwo' })).toBeVisible()
})

test('the Map: a pin takes focus, Enter selects it and Open entry is reachable', async ({
  page,
  api,
  journal,
}) => {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.abort())
  const place: Location = {
    latitude: 39.7527,
    longitude: -105.0002,
    placeName: 'Union Station',
    locality: null,
    region: null,
    country: null,
    address: null,
    googlePlaceId: null,
  }
  await api.createEntry({ journalId: journal.id, bodyMd: '# Pin by keyboard', location: place })
  await page.goto(`/j/${journal.id}`)
  await page.getByRole('radio', { name: 'Map' }).click()

  const map = page.getByRole('region', { name: 'Map of entries' })
  const pin = map.getByRole('button', { name: 'Pin by keyboard' })
  await pin.focus()
  await page.keyboard.press('Enter')
  await expect(map).toContainText('Union Station')
  await map.getByRole('button', { name: 'Open entry' }).focus()
  await page.keyboard.press('Enter')
  await expect(entryPane(page).getByRole('heading', { name: 'Pin by keyboard' })).toBeVisible()
})
