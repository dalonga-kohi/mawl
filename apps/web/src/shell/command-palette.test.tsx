import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { renderApp, stubViewport } from '../test/render-app.tsx'

beforeEach(() => stubViewport(1440))

describe('command palette', () => {
  it('opens with Ctrl+K and closes with Escape', async () => {
    const { user } = await renderApp('/t')
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull()
    await user.keyboard('{Control>}k{/Control}')
    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeTruthy()
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull(),
    )
  })

  it('opens from the sidebar on any page, including phone widths', async () => {
    stubViewport(390)
    const { user } = await renderApp('/settings')
    await user.click(screen.getByRole('button', { name: 'Show sidebar' }))
    const nav = await screen.findByRole('navigation', { name: 'Main' })
    await user.click(within(nav).getByRole('button', { name: /^Search/ }))
    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeTruthy()
  })

  it('also opens with the Meta key (Cmd on macOS)', async () => {
    const { user } = await renderApp('/t')
    await user.keyboard('{Meta>}k{/Meta}')
    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeTruthy()
  })

  it('opens from the search row in the sidebar', async () => {
    const { user } = await renderApp('/t')
    const nav = screen.getByRole('navigation', { name: 'Main' })
    await user.click(within(nav).getByRole('button', { name: /^Search/ }))
    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeTruthy()
  })

  it('still lists Memory and Activity, which have no sidebar row', async () => {
    const { user } = await renderApp('/t')
    await user.keyboard('{Control>}k{/Control}')
    expect(await screen.findByRole('option', { name: 'Memory' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Activity' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Tools' })).toBeTruthy()
  })

  it('jumps to a view', async () => {
    const { user, router } = await renderApp('/t')
    await user.keyboard('{Control>}k{/Control}')
    await user.keyboard('routines')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(router.state.location.pathname).toBe('/routines'))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull(),
    )
  })

  it('switches the theme', async () => {
    const { user } = await renderApp('/t')
    await user.keyboard('{Control>}k{/Control}')
    await user.click(await screen.findByRole('option', { name: 'Dark theme' }))
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('changes the accent', async () => {
    const { user } = await renderApp('/t')
    await user.keyboard('{Control>}k{/Control}')
    await user.keyboard('peach')
    await user.keyboard('{Enter}')
    expect(JSON.parse(localStorage.getItem('mawl.appearance') ?? '{}').accent).toBe('#F7C4A3')
  })

  it('says so when nothing matches', async () => {
    const { user } = await renderApp('/t')
    await user.keyboard('{Control>}k{/Control}')
    await user.keyboard('zzzqqq')
    expect(await screen.findByText('No matches. Try a view name like "Settings".')).toBeTruthy()
  })
})
