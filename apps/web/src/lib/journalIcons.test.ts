import { describe, expect, it } from 'vitest'
import iconSrc from '../components/Icon.tsx?raw'
import { CreateJournalSchema, JOURNAL_ICONS } from '@cairn/shared'
import { firstEmoji } from './journalIcons.ts'

describe('firstEmoji', () => {
  it('keeps one whole emoji, however it is built', () => {
    expect(firstEmoji('🍋')).toBe('🍋')
    expect(firstEmoji('👨‍👩‍👧')).toBe('👨‍👩‍👧')
    expect(firstEmoji('🇳🇴x')).toBe(null) // a flag is two regional indicators, not pictographic: not offered
  })
  it('takes the first of several and ignores text', () => {
    expect(firstEmoji('ab🌿🍋')).toBe('🌿')
    expect(firstEmoji('lemon')).toBeNull()
    expect(firstEmoji('')).toBeNull()
  })
})

describe('journal icon schema', () => {
  it('takes an icon name or one emoji, nothing else', () => {
    const ok = (icon: string) => CreateJournalSchema.safeParse({ name: 'x', icon }).success
    expect(ok('local_florist')).toBe(true)
    expect(ok('🍋')).toBe(true)
    expect(ok('not_an_icon')).toBe(false)
    expect(ok('🍋🌿')).toBe(false)
  })
  it('only names icons the app bundles', () => {
    for (const n of JOURNAL_ICONS) expect(iconSrc, n).toContain(`'${n}'`)
  })
})
