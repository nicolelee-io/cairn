// A journal's icon is a Material name from JOURNAL_ICONS (@cairn/shared) or one emoji; the picker's
// grid is the names, its "Other" field takes any emoji (the phone's emoji keyboard).

/** The first emoji in what was typed (a pasted word leaves nothing), or null for none. */
export function firstEmoji(text: string): string | null {
  for (const { segment } of new Intl.Segmenter().segment(text)) {
    if (/\p{Extended_Pictographic}/u.test(segment)) return segment
  }
  return null
}
