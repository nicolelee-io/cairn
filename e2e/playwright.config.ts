import { defineConfig, devices } from '@playwright/test'
import { AUTH_STATE, BASE_URL, E2E_PORT, E2E_TIMEZONE } from './env.ts'

export default defineConfig({
  testDir: '.',
  outputDir: '.results',
  fullyParallel: true,
  // Each worker is a Chromium instance; the default (half the cores) has crashed WSL on the laptop.
  // Override with --workers.
  workers: 2,
  forbidOnly: true,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: '.report', open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    timezoneId: E2E_TIMEZONE,
    locale: 'en-US',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'phone',
      use: { ...devices['Pixel 7'], storageState: AUTH_STATE },
      dependencies: ['setup'],
    },
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1400, height: 900 },
        storageState: AUTH_STATE,
      },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    command: 'npx tsx e2e/start-server.ts',
    cwd: '..',
    // IPv6 loopback on purpose: under WSL2 mirrored networking a closed IPv4 loopback port hangs
    // for ~2 minutes instead of refusing, and Playwright checks the port before starting the server.
    url: `http://[::1]:${E2E_PORT}/api/health`,
    // Never reuse: a server already on 3200 could be pointing at other data.
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
