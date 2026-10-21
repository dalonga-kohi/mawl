import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { renderApp, stubViewport } from '../test/render-app.tsx'

beforeEach(() => stubViewport(1440))

const selected = () =>
  screen
    .getAllByRole('tab')
    .filter((t) => t.getAttribute('aria-selected') === 'true')
    .map((t) => t.textContent)

describe('tools page', () => {
  it('opens on Connections with a title, a subtitle and three tabs', async () => {
    await renderApp('/tools')
    expect(await screen.findByRole('heading', { level: 1, name: 'Tools' })).toBeTruthy()
    expect(screen.getByText('Connect apps, teach skills and add plugins.')).toBeTruthy()
    const tabs = within(screen.getByRole('tablist', { name: 'Tools' })).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Connections', 'Skills', 'Plugins'])
    expect(selected()).toEqual(['Connections'])
    expect(screen.getByRole('heading', { level: 2, name: 'No connections yet' })).toBeTruthy()
  })

  it('never says MCP on the page itself', async () => {
    await renderApp('/tools')
    await screen.findByRole('heading', { level: 1, name: 'Tools' })
    expect(document.body.textContent).not.toMatch(/MCP/)
  })

  it('keeps the tab in the URL', async () => {
    const { user, router } = await renderApp('/tools')
    await user.click(await screen.findByRole('tab', { name: 'Skills' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'skills' }))
    expect(screen.getByRole('heading', { level: 2, name: 'No skills yet' })).toBeTruthy()
    expect(screen.getByText('Skills your teammates learn will show up here.')).toBeTruthy()
    await user.click(screen.getByRole('tab', { name: 'Plugins' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'plugins' }))
    expect(screen.getByRole('heading', { level: 2, name: 'No plugins yet' })).toBeTruthy()
    expect(
      screen.getByText('Plugins bundle skills and connections. Importing them is coming soon.'),
    ).toBeTruthy()
  })

  it('opens the tab named in the URL', async () => {
    await renderApp('/tools?tab=plugins')
    await screen.findByRole('heading', { level: 1, name: 'Tools' })
    expect(selected()).toEqual(['Plugins'])
  })

  it('falls back to Connections for an unknown tab', async () => {
    await renderApp('/tools?tab=nope')
    await screen.findByRole('heading', { level: 1, name: 'Tools' })
    expect(selected()).toEqual(['Connections'])
  })

  it('redirects /connections to the Connections tab', async () => {
    const { router } = await renderApp('/connections')
    await waitFor(() => expect(router.state.location.pathname).toBe('/tools'))
    expect(router.state.location.search).toEqual({ tab: 'connections' })
    expect(selected()).toEqual(['Connections'])
  })
})
