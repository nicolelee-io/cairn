import { createRequire } from 'node:module'
import { expect, test } from './helpers/test.ts'

// CommonJS, loaded the same way as sharp in photos.spec.ts.
const yauzl = createRequire(import.meta.url)('yauzl') as typeof import('yauzl')

/** Every file in a zip, by name. */
function readZip(path: string): Promise<Map<string, string>> {
  return new Promise((resolve, reject) => {
    const files = new Map<string, string>()
    yauzl.open(path, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err)
      zip.on('entry', (entry: import('yauzl').Entry) => {
        zip.openReadStream(entry, (e, stream) => {
          if (e) return reject(e)
          const chunks: Buffer[] = []
          stream.on('data', (c: Buffer) => chunks.push(c))
          stream.on('end', () => {
            files.set(entry.fileName, Buffer.concat(chunks).toString('utf8'))
            zip.readEntry()
          })
        })
      })
      zip.on('end', () => resolve(files))
      zip.on('error', reject)
      zip.readEntry()
    })
  })
}

test('export one journal as a Day One zip', async ({ page, api, journal }, info) => {
  await api.createEntry({ journalId: journal.id, bodyMd: '# Exported\n\nA line to find again' })

  await page.goto('/settings/export')
  await page.getByRole('button', { name: 'Journal to export' }).click()
  await page.getByRole('option', { name: journal.name }).click()
  await page.getByRole('switch', { name: 'Include photos' }).click()

  const download = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Export', exact: true }).click()
  const path = info.outputPath('export.zip')
  await (await download).saveAs(path)

  const files = await readZip(path)
  const json = [...files.keys()].filter((name) => name.endsWith('.json'))
  expect(json).toEqual([`${journal.name}.json`])
  const { entries } = JSON.parse(files.get(json[0]!)!) as { entries: { text: string }[] }
  expect(entries).toHaveLength(1)
  expect(entries[0]!.text).toContain('A line to find again')
})
