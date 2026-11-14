import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildTheme, themeCss } from './buildTheme.ts'

const theme = buildTheme()
writeFileSync(join(import.meta.dirname, 'theme.css'), themeCss(theme))

// The address-bar colour follows the system scheme too; index.html can't read CSS variables.
const html = join(import.meta.dirname, '../../index.html')
const metas = `<meta name="theme-color" media="(prefers-color-scheme: light)" content="${theme.light.surface}" />
    <meta name="theme-color" media="(prefers-color-scheme: dark)" content="${theme.dark.surface}" />`
const src = readFileSync(html, 'utf8')
const next = src.replace(
  /(<!-- theme-color -->)[\s\S]*?(<!-- \/theme-color -->)/,
  `$1\n    ${metas}\n    $2`,
)
if (next === src && !src.includes(metas))
  throw new Error('theme-color markers missing in index.html')
writeFileSync(html, next)

// A manifest has one theme_color and no media queries (Chrome on Android doesn't read a dark one),
// and an installed Android app paints its navigation bar with it: Chrome bakes it into the WebAPK,
// and the page's theme-color metas don't reach the nav bar. So it is the dark surface, which suits
// the usual dark phone; the metas above still set the status bar per scheme once the page is open.
// background_color is the splash, the dark surface for the same reason.
const icon = (src: string, sizes: string, purpose: string) => ({
  src,
  sizes,
  type: 'image/png',
  purpose,
})
const manifest = {
  name: 'Cairn',
  short_name: 'Cairn',
  description: 'A private journal.',
  id: '/',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  orientation: 'any',
  theme_color: theme.dark.surface,
  background_color: theme.dark.surface,
  icons: [
    icon('/icon-192.png', '192x192', 'any'),
    icon('/icon-512.png', '512x512', 'any'),
    icon('/icon-maskable-512.png', '512x512', 'maskable'),
    icon('/icon-monochrome-512.png', '512x512', 'monochrome'),
  ],
}
writeFileSync(
  join(import.meta.dirname, '../../public/manifest.webmanifest'),
  JSON.stringify(manifest, null, 2) + '\n',
)
console.log(`wrote theme.css, theme-color metas and manifest for seed ${theme.seed}`)
