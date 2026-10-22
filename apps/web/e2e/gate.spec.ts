import { expect, test } from '@playwright/test'
import { E2E_TOKEN } from './fixtures.ts'

// The headless path: no injected token, so the owner types it on the gate.
test('the gate refuses a wrong owner token and opens the app with the right one', async ({
  page,
}) => {
  await page.goto('/t')
  await expect(page.getByRole('heading', { name: 'Enter your owner token' })).toBeVisible()
  const field = page.getByLabel('Owner token')

  await field.fill(`${E2E_TOKEN.slice(0, -1)}x`)
  await page.getByRole('button', { name: 'Open Mawl' }).click()
  await expect(page.getByRole('alert')).toHaveText(
    "That token didn't work. Check it and try again.",
  )
  await expect(field).toHaveValue('')

  await field.fill(E2E_TOKEN)
  await page.getByRole('button', { name: 'Open Mawl' }).click()
  const sidebar = page.getByRole('complementary', { name: 'Sidebar' })
  await expect(sidebar.getByRole('heading', { name: 'Teammates' })).toBeVisible()
  // Never in the url.
  expect(page.url()).not.toContain(E2E_TOKEN)
})
