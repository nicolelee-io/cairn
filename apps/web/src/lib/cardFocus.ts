/**
 * Moves keyboard focus to the next or previous entry card in a list (the j and k keys, while no
 * entry is open: with one open they flip entries instead). Focus starts from the card in focus,
 * else from the one open in the reader, else the first.
 */
export function moveCard(container: HTMLElement | null, dir: 1 | -1) {
  const cards = [...(container?.querySelectorAll<HTMLAnchorElement>('a[data-entry-card]') ?? [])]
  if (cards.length === 0) return
  let from = cards.findIndex((c) => c === document.activeElement)
  if (from < 0) from = cards.findIndex((c) => c.getAttribute('aria-current') === 'page')
  const next = from < 0 ? 0 : Math.min(Math.max(from + dir, 0), cards.length - 1)
  const card = cards[next]
  if (!card) return
  card.focus()
}

/**
 * Moves focus to the previous or next calendar day that has entries (a `button[data-day]`), in
 * page order. With nothing in focus it starts from the first one on screen.
 */
export function moveDay(dir: 1 | -1) {
  const days = [...document.querySelectorAll<HTMLButtonElement>('button[data-day]')]
  if (days.length === 0) return
  const from = days.findIndex((d) => d === document.activeElement)
  if (from < 0) {
    const onScreen = days.find((d) => {
      const r = d.getBoundingClientRect()
      return r.top >= 0 && r.bottom <= window.innerHeight
    })
    ;(onScreen ?? days[0])?.focus()
    return
  }
  days[Math.min(Math.max(from + dir, 0), days.length - 1)]?.focus()
}
