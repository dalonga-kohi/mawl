import { expect, test } from './fixtures.ts'

test('the app loads and shows the sidebar with the teammates group', async ({ page }) => {
  await page.goto('/t')
  const sidebar = page.getByRole('complementary', { name: 'Sidebar' })
  await expect(sidebar.getByRole('heading', { name: 'Teammates' })).toBeVisible()
})

test('RPC reaches the e2e server: Settings lists the seeded fake model credential', async ({
  page,
}) => {
  await page.goto('/settings?section=models')
  await expect(page.getByRole('heading', { name: 'E2E fake model' })).toBeVisible()
})
