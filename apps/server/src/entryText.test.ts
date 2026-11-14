import { describe, expect, it } from 'vitest'
import { splitTitle, summarize } from './entryText.ts'

// The search index and the cards must agree on what the title is.
const SAMPLES = [
  '# Hike\n\nStarted early.\n\n![](photo:abc)\n\nMidway **view**.',
  'Escape room with Zach\nI felt good today.',
  'A first line that is long enough to be prose rather than a title because it keeps on going and going.',
  `# ${'word '.repeat(40)}\n\nbody`,
  '![](photo:a)\n![](photo:b)',
  '',
  '- one \\- two\n> quoted [link](http://x)',
  '\n\n   \n## After blank lines\ntext',
]

describe('splitTitle', () => {
  it.each(SAMPLES)('finds the same title as summarize: %j', (body) => {
    expect(splitTitle(body).title).toBe(summarize(body).title)
  })

  it('leaves the title out of the rest, and keeps all of the text when there is no title', () => {
    expect(splitTitle('# Hike\n\nStarted early.\n\n![](photo:abc)\n\nMidway **view**.')).toEqual({
      title: 'Hike',
      rest: 'Started early. Midway view.',
    })
    const prose =
      'A first line that is long enough to be prose rather than a title because it keeps on going and going.'
    expect(splitTitle(`${prose}\nSecond line`)).toEqual({ title: '', rest: `${prose} Second line` })
  })

  it('keeps the full text of a heading that the card clips', () => {
    const long = `# ${'word '.repeat(40)}`.trim()
    const { title, rest } = splitTitle(`${long}\n\nafter`)
    expect(title.endsWith('…')).toBe(true)
    expect(rest).toContain('word word')
    expect(rest.endsWith('after')).toBe(true)
    expect(rest.split(' ').filter((w) => w === 'word')).toHaveLength(40)
  })
})
