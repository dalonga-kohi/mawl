import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { credential } from '../test/fake-providers-api.ts'
import { fakeApi, renderApp, stubViewport } from '../test/render-app.tsx'

beforeEach(() => stubViewport(1440))

async function openDialog() {
  const fake = fakeApi({ credentials: [credential({ provider: 'openai', label: 'OpenAI' })] })
  const view = await renderApp('/t', fake.api)
  await view.user.click(await screen.findByRole('button', { name: 'Create a teammate' }))
  const dialog = await screen.findByRole('dialog', { name: 'New teammate' })
  return { ...view, fake, dialog }
}

describe('new teammate dialog', () => {
  it('uses rounded fields, a rounded select and a job card', async () => {
    const { dialog } = await openDialog()
    expect(within(dialog).getByLabelText('Name').className).toContain('rounded-card')
    expect(within(dialog).getByLabelText('Model').className).toContain('rounded-card')
    const select = within(dialog).getByLabelText('Model connection')
    expect(select.tagName).toBe('SELECT')
    expect(select.className).toContain('rounded-card')
    expect(select.className).toContain('appearance-none')
    expect(within(dialog).getByLabelText('Job (optional)').className).toContain('rounded-card')
  })

  it('has rounded Cancel and Create buttons that are named and 44 px on touch', async () => {
    const { dialog } = await openDialog()
    for (const name of ['Cancel', 'Create teammate']) {
      const button = within(dialog).getByRole('button', { name })
      expect(button.className).toContain('rounded-md')
      expect(button.className).toContain('pointer-coarse:h-11')
    }
  })

  it('closes on Escape and returns focus', async () => {
    const { user } = await openDialog()
    await user.keyboard('{Escape}')
    await screen.findByRole('button', { name: 'Create a teammate' })
    expect(screen.queryByRole('dialog', { name: 'New teammate' })).toBeNull()
  })

  it('tells a too-long name how to fix it, next to the field', async () => {
    const { user, dialog, fake } = await openDialog()
    const name = within(dialog).getByLabelText('Name')
    await user.click(name)
    await user.paste('x'.repeat(81))
    await user.click(within(dialog).getByRole('button', { name: 'Create teammate' }))
    expect(within(dialog).getByText('Keep the name under 80 characters.')).toBeTruthy()
    expect(name.getAttribute('aria-invalid')).toBe('true')
    expect(name.getAttribute('aria-describedby')).toBeTruthy()
    expect(fake.chat.created).toEqual([])
  })
})
