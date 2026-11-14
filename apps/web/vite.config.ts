import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'

// Writes asset-list.json: the /assets files of this build. The page uses it to drop older builds'
// files from the service worker's cache (lib/offlineCache.ts `pruneStaleAssets`).
function assetList(): Plugin {
  return {
    name: 'cairn-asset-list',
    generateBundle(_, bundle) {
      const files = Object.keys(bundle).map((f) => `/${f}`)
      this.emitFile({ type: 'asset', fileName: 'asset-list.json', source: JSON.stringify(files) })
    },
  }
}

export default defineConfig({
  // Which build this is (GIT_SHA and BUILD_DATE come from the image build); lib/appVersion.ts.
  define: {
    __APP_SHA__: JSON.stringify(process.env.GIT_SHA || 'dev'),
    __APP_BUILT__: JSON.stringify(process.env.BUILD_DATE || null),
    __APP_VERSION__: JSON.stringify(
      (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version,
    ),
  },
  plugins: [react(), tailwindcss(), assetList()],
  server: {
    proxy: {
      // changeOrigin must stay false: the server's CSRF check compares Origin with Host, so the
      // browser's own Host (localhost:5173) has to reach it, as it does behind the tunnel in prod.
      '/api': { target: process.env.API_URL ?? 'http://localhost:3000', changeOrigin: false },
    },
  },
})
