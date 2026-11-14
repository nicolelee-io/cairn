import { defineConfig } from 'vitest/config'

export default defineConfig({
  // The web build's constants (apps/web/vite.config.ts), for modules under test.
  define: { __APP_SHA__: JSON.stringify('dev'), __APP_BUILT__: 'null', __APP_VERSION__: JSON.stringify('0.0.0') },
  test: {
    // Each worker is a full Node process; the default (cores - 1) has crashed WSL on the laptop.
    // Override with --maxWorkers.
    maxWorkers: 2,
    include: ['{apps,packages}/**/*.test.{ts,tsx}'],
    // Its ESM build uses extensionless imports that plain Node can't resolve; let Vite transform it.
    server: { deps: { inline: ['@material/material-color-utilities'] } },
  },
})
