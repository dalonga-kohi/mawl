import type { Page } from '@playwright/test'
import { expect, test } from './fixtures.ts'

// The e2e server answers every run with a scripted echo model (apps/server/src/e2e): it streams
// `Echo: <message>`, a long paragraph for `/slow`, and fails `/fail` as plan_limit_reached.

async function createTeammate(page: Page, name: string) {
  await page.goto('/t')
  await page.getByRole('button', { name: 'New teammate' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'New teammate' })
  await dialog.getByLabel('Name').fill(name)
  await dialog.getByLabel('Model connection').selectOption({ label: 'E2E fake model' })
  await dialog.getByLabel('Model', { exact: true }).fill('fake-echo')
  await dialog.getByRole('button', { name: 'Create teammate' }).click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
}

test('send a message and watch the reply stream in, then persist', async ({ page }) => {
  const name = `Echo ${Date.now()}`
  await createTeammate(page, name)
  const box = page.getByLabel(`Message ${name}`)
  await box.fill('Say hello')
  await box.press('Enter')

  // While streaming, the reply is a live article and the composer offers Stop.
  await expect(page.getByRole('article', { name: `${name} is replying` })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible()

  const reply = page.getByRole('article', { name: 'Reply' })
  await expect(reply).toContainText('Echo: Say hello')
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible()
  await expect(page).toHaveURL(/thread=thr_/)

  // The stored conversation survives a reload.
  await page.reload()
  await expect(page.getByRole('article', { name: 'Reply' })).toContainText('Echo: Say hello')
})

test('stop a long reply', async ({ page }) => {
  const name = `Slow ${Date.now()}`
  await createTeammate(page, name)
  const box = page.getByLabel(`Message ${name}`)
  await box.fill('Tell me a long story /slow')
  await box.press('Enter')
  await expect(page.getByRole('article', { name: `${name} is replying` })).toContainText('quick')
  await page.getByRole('button', { name: 'Stop' }).click()
  // With or without the partial text still on screen (the event store drops it soon after).
  await expect(page.getByText(/^Stopped\. (The partial|Nothing more)/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible()
})

test('a failed run explains what happened and where to fix it', async ({ page }) => {
  const name = `Fail ${Date.now()}`
  await createTeammate(page, name)
  const box = page.getByLabel(`Message ${name}`)
  await box.fill('This will fail /fail')
  await box.press('Enter')
  const alert = page.getByRole('alert')
  await expect(alert).toContainText("You've reached your plan's usage limit.")
  await expect(alert.getByRole('link', { name: 'Open model settings' })).toBeVisible()
})
