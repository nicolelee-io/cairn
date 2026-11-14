import { z } from 'zod'

/** The reading fonts a user can pick for entry text; `literata` is the default. */
export const ENTRY_FONTS = ['literata', 'lora', 'source-serif', 'atkinson', 'inter'] as const
export const EntryFontSchema = z.enum(ENTRY_FONTS)
export type EntryFont = z.infer<typeof EntryFontSchema>

/** How large entry text is in the editor and reader (not the list excerpts). */
export const ENTRY_TEXT_SIZES = ['small', 'default', 'large', 'larger'] as const
export const EntryTextSizeSchema = z.enum(ENTRY_TEXT_SIZES)
export type EntryTextSize = z.infer<typeof EntryTextSizeSchema>

/** The multiplier each size puts on the entry text (`--entry-scale`). */
export const ENTRY_TEXT_SCALE: Record<EntryTextSize, number> = {
  small: 0.9,
  default: 1,
  large: 1.15,
  larger: 1.3,
}
