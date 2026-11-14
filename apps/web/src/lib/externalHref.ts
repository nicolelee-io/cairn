/**
 * A link typed as `example.com/page` has no scheme, so the browser would read it as a path inside
 * Cairn. A bare domain gets https://; anything with a scheme, a path (`/x`), an anchor or a query is left alone.
 */
export function externalHref(href: string | undefined): string | undefined {
  if (!href) return href
  // A domain with a port (`example.com:8080`) looks like a scheme, so check for it first.
  if (/^[^/\s:@]+\.[a-z]{2,}(:\d+)?([/?#]|$)/i.test(href)) return `https://${href}`
  return href
}
