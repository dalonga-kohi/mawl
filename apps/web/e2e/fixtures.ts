import { test as base } from '@playwright/test'

/**
 * The fixed owner token of the e2e server (playwright.config.ts passes it as MAWL_OWNER_TOKEN).
 * Not a secret: it only guards the throwaway e2e server on loopback.
 */
export const E2E_TOKEN = 'mawl-e2e-owner-token_0123456789abcdefgh'

/**
 * Pages open as the desktop app does: the token is injected before any script runs, the way
 * the Tauri host's initialization script will (D1.5), so specs start past the token gate.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript((token) => {
      ;(window as { __MAWL_LAUNCH_TOKEN__?: string }).__MAWL_LAUNCH_TOKEN__ = token
    }, E2E_TOKEN)
    await use(page)
  },
})

export { expect } from '@playwright/test'
