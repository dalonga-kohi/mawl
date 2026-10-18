import { defineConfig } from '@playwright/test'

// Browser e2e: the Vite app talks to a real faire-server (on a throwaway Postgres) whose runs are
// answered by a scripted echo model, so no API key or network is needed. See
// apps/server/src/e2e/. Run it with `pnpm test:e2e`; it is not part of the turbo gate.
const SERVER_PORT = 7421
const WEB_PORT = 5174
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`

export default defineConfig({
  testDir: 'e2e',
  // One database is shared by every spec.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: WEB_URL,
    // Edge ships with Windows, so nothing is downloaded locally. CI installs Chromium.
    channel: process.env.CI ? undefined : 'msedge',
    trace: 'on-first-retry',
  },
  webServer: [
    {
      // Container pull plus boot can be slow on a cold machine.
      command: 'pnpm --filter @faire/server e2e:serve',
      url: `${SERVER_URL}/healthz`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: { FAIRE_E2E: '1', FAIRE_PORT: String(SERVER_PORT) },
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: `pnpm exec vite --config vitest.config.ts --port ${WEB_PORT} --strictPort`,
      url: WEB_URL,
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
      env: { FAIRE_DEV_SERVER: SERVER_URL },
    },
  ],
})
