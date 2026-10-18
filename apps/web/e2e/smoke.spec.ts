import { expect, test } from '@playwright/test'

test('the app loads and shows the teammates list', async ({ page }) => {
  await page.goto('/t')
  await expect(page.getByRole('heading', { name: 'Teammates' }).first()).toBeVisible()
})

test('RPC reaches the e2e server: Settings lists the seeded fake model credential', async ({
  page,
}) => {
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'E2E fake model' })).toBeVisible()
})
