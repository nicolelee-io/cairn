/**
 * Muted swatches to colour-code journals; stored as #rrggbb. null means the theme's primary.
 * Eleven hues spaced around the wheel at nearly the same lightness (CIELAB L* 48-56) and low chroma,
 * plus a graphite: every pair is at least 14 apart in CIELAB (ΔE76) and every swatch keeps 3:1
 * against the light and the dark surface (`journalColors.test.ts`). The first is the theme seed.
 */
export const JOURNAL_COLORS = [
  '#7b7b45', // olive (the seed)
  '#5d8056', // green
  '#43826f', // sea green
  '#328086', // teal
  '#347d9a', // steel blue
  '#5277a8', // blue
  '#806d9b', // heather
  '#9f6186', // plum
  '#ae5e5c', // rose brick
  '#a5684a', // clay
  '#9c7e48', // ochre
  '#757570', // graphite
] as const

/** The first swatch no journal wears yet (the first swatch again once all are taken). */
export function nextJournalColor(used: readonly (string | null)[]): string {
  const taken = new Set(used.map((c) => c?.toLowerCase()))
  return JOURNAL_COLORS.find((c) => !taken.has(c)) ?? JOURNAL_COLORS[0]
}

/**
 * A soft wash of a journal's colour over a theme surface, for a chip or a selected row. Text on it
 * stays the theme's own, so contrast never depends on the journal's colour. undefined (no colour)
 * leaves the element's own class to colour it. `over` is a role in theme.css (`--md-<role>`; the
 * Tailwind `--color-*` twins only exist when a utility happens to use them).
 */
export function journalWash(
  color: string | null | undefined,
  over = 'surface-container-high',
  percent = 18,
): string | undefined {
  return color ? `color-mix(in oklab, ${color} ${percent}%, var(--md-${over}))` : undefined
}
