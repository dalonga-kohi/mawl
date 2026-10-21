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

  it('opens from the rail on any page, including phone widths', async () => {
    stubViewport(390)
    const { user } = await renderApp('/settings')
    const nav = screen.getByRole('navigation', { name: 'Main' })
    await user.click(within(nav).getByRole('button', { name: 'Search or jump to' }))
    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeTruthy()
  })

  it('also opens with the Meta key (Cmd on macOS)', async () => {
    const { user } = await renderApp('/t')
    await user.keyboard('{Meta>}k{/Meta}')
    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeTruthy()
  })

  it('opens from the search button in the teammate list', async () => {
    const { user } = await renderApp('/t')
    const list = screen.getByRole('complementary', { name: 'Teammates' })
    await user.click(within(list).getByRole('button', { name: /Search or jump to/ }))
    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeTruthy()
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
    await user.keyboard('coral')
    await user.keyboard('{Enter}')
    expect(JSON.parse(localStorage.getItem('mawl.appearance') ?? '{}').accent).toBe('#EF6F5E')
  })

  it('says so when nothing matches', async () => {
    const { user } = await renderApp('/t')
    await user.keyboard('{Control>}k{/Control}')
    await user.keyboard('zzzqqq')
    expect(await screen.findByText('No matches. Try a view name like "Settings".')).toBeTruthy()
  })
})
