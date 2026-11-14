import { describe, expect, it } from 'vitest'
import { buildTheme, contrast, themeCss, type Palette } from './buildTheme.ts'

const theme = buildTheme()

// Foreground / background pairs the UI actually draws, as [text role, surface role, min ratio].
// 4.5 is WCAG AA for body text; 3 is the floor for non-text UI such as borders and icons.
const PAIRS: [keyof Palette, keyof Palette, number][] = [
  ['onBackground', 'background', 4.5],
  ['onSurface', 'surface', 4.5],
  ['onSurface', 'surfaceContainerLow', 4.5],
  ['onSurface', 'surfaceContainer', 4.5],
  ['onSurface', 'surfaceContainerHighest', 4.5],
  ['onSurfaceVariant', 'surface', 4.5],
  ['onSurfaceVariant', 'surfaceContainer', 4.5],
  ['onSurface', 'surfaceContainerHigh', 4.5], // the day pill
  ['onSurfaceVariant', 'surfaceContainerHigh', 4.5],
  ['primary', 'surface', 4.5], // links and active labels
  ['primary', 'surfaceContainer', 4.5],
  ['primary', 'surfaceContainerLow', 4.5], // Settings: Remove picture
  ['error', 'surfaceContainerLow', 4.5], // Settings: Sign out row
  ['onPrimary', 'primary', 4.5],
  ['onPrimaryContainer', 'primaryContainer', 4.5],
  ['onSecondaryContainer', 'secondaryContainer', 4.5], // selected nav item and selected card
  ['onSurfaceVariant', 'secondaryContainer', 4.5], // muted text inside a selected card
  ['onTertiaryContainer', 'tertiaryContainer', 4.5], // weather chips
  ['onError', 'error', 4.5],
  ['onErrorContainer', 'errorContainer', 4.5],
  ['inverseOnSurface', 'inverseSurface', 4.5],
  ['outline', 'surface', 3],
]

describe('theme', () => {
  for (const mode of ['light', 'dark'] as const) {
    it.each(PAIRS)(`${mode}: %s on %s is at least %s:1`, (fg, bg, min) => {
      expect(contrast(theme[mode][fg], theme[mode][bg])).toBeGreaterThanOrEqual(min)
    })
  }

  it('keeps the primary muted and olive rather than lime or saturated', () => {
    // Guards the hand-set chroma: the library default would push this toward lime.
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(theme.light.primary.slice(i, i + 2), 16))
    expect(Math.max(r!, g!, b!) - Math.min(r!, g!, b!)).toBeLessThan(90)
    expect(g!).toBeGreaterThanOrEqual(b!) // greenish/olive, not blue or pink
  })

  it('emits both schemes as CSS variables', () => {
    const css = themeCss(theme)
    expect(css).toContain(`--md-primary: ${theme.light.primary};`)
    expect(css).toContain('@media (prefers-color-scheme: dark)')
    expect(css).toContain(`--md-primary: ${theme.dark.primary};`)
  })

  it('lets data-theme force either scheme', () => {
    const css = themeCss(theme)
    expect(css).toContain(":root[data-theme='dark'] {")
    expect(css).toContain(":root:not([data-theme='light'])")
    // The forced-dark block carries the dark palette, not just a color-scheme hint.
    const forced = css.slice(css.indexOf(":root[data-theme='dark'] {"))
    expect(forced).toContain(`--md-primary: ${theme.dark.primary};`)
  })
})
