import { describe, expect, it } from 'vitest'
import { buildTheme, contrast } from '../theme/buildTheme.ts'
import { JOURNAL_COLORS, journalWash, nextJournalColor } from './journalColors.ts'

const theme = buildTheme()

function toLab(hex: string): [number, number, number] {
  const lin = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  const [r, g, b] = lin
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047)
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b)
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}

describe('journal colours', () => {
  it('are lowercase #rrggbb, with no duplicates', () => {
    for (const c of JOURNAL_COLORS) expect(c).toMatch(/^#[0-9a-f]{6}$/)
    expect(new Set(JOURNAL_COLORS).size).toBe(JOURNAL_COLORS.length)
  })

  it('stay apart: every pair differs by at least 14 in CIELAB', () => {
    const labs = JOURNAL_COLORS.map(toLab)
    for (let i = 0; i < labs.length; i++) {
      for (let j = i + 1; j < labs.length; j++) {
        const d = Math.hypot(...labs[i]!.map((v, k) => v - labs[j]![k]!))
        expect(d, `${JOURNAL_COLORS[i]} vs ${JOURNAL_COLORS[j]}`).toBeGreaterThanOrEqual(14)
      }
    }
  })

  // The colour is drawn as dots, bars and rules (non-text), so 3:1 is the floor.
  for (const mode of ['light', 'dark'] as const) {
    it(`${mode}: every swatch is at least 3:1 on the surfaces it sits on`, () => {
      for (const c of JOURNAL_COLORS) {
        for (const bg of ['surface', 'surfaceContainerLow', 'surfaceContainerHigh'] as const) {
          expect(contrast(c, theme[mode][bg]), `${c} on ${bg}`).toBeGreaterThanOrEqual(3)
        }
      }
    })
  }

  // The washes (chip, selected row, calendar day) keep the theme's own text; mixed here in linear
  // light, which stands in for the browser's oklab mix closely enough for a 4.5:1 check.
  const mix = (a: string, b: string, pct: number) => {
    const lin = (h: string, i: number) => (parseInt(h.slice(i, i + 2), 16) / 255) ** 2.2
    const ch = (i: number) =>
      Math.round(255 * (lin(a, i) * pct + lin(b, i) * (1 - pct)) ** (1 / 2.2))
        .toString(16)
        .padStart(2, '0')
    return `#${ch(1)}${ch(3)}${ch(5)}`
  }
  const WASHES = [
    ['surfaceContainerHigh', 'onSurface', 0.18], // reader chip
    ['surfaceContainerHigh', 'onSurface', 0.35], // top bar title pill
    ['secondaryContainer', 'onSecondaryContainer', 0.3], // selected nav row
    ['surfaceContainerLow', 'onSurface', 0.38], // calendar day
    ['surfaceContainerLow', 'onSurface', 0.08], // entry card
    ['surfaceContainerLow', 'onSurfaceVariant', 0.08], // entry card's muted text
    ['surfaceContainerLow', 'onSurfaceVariant', 0.25], // journal chip on a card (washed twice, so this is the worst case)
  ] as const
  for (const mode of ['light', 'dark'] as const) {
    it(`${mode}: text stays at least 4.5:1 on every wash`, () => {
      for (const c of JOURNAL_COLORS) {
        for (const [bg, fg, pct] of WASHES) {
          const wash = mix(c, theme[mode][bg], pct)
          expect(
            contrast(theme[mode][fg], wash),
            `${fg} on ${c} over ${bg}`,
          ).toBeGreaterThanOrEqual(4.5)
        }
      }
    })
  }

  it('nextJournalColor takes the first swatch not in use, then wraps', () => {
    expect(nextJournalColor([])).toBe(JOURNAL_COLORS[0])
    expect(nextJournalColor([JOURNAL_COLORS[0], null, JOURNAL_COLORS[2]])).toBe(JOURNAL_COLORS[1])
    expect(nextJournalColor(JOURNAL_COLORS.map((c) => c.toUpperCase()))).toBe(JOURNAL_COLORS[0])
  })

  it('journalWash is empty without a colour', () => {
    expect(journalWash(null)).toBeUndefined()
    expect(journalWash('#7b7b45')).toContain('#7b7b45')
  })
})
