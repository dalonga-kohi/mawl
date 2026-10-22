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
    expect(await screen.findByText('Nothing found')).toBeTruthy()
  })

  it('is a round card with a pill search field and pill rows with a shortcut hint', async () => {
    const { user } = await renderApp('/t')
    await user.keyboard('{Control>}k{/Control}')
    const dialog = await screen.findByRole('dialog', { name: 'Command palette' })
    expect(dialog.className).toContain('rounded-panel')
    const search = within(dialog).getByRole('combobox')
    expect(search.className).toContain('rounded-pill')
    expect(search.className).toContain('outline-none')
    expect(search.getAttribute('aria-label')).toBe('Search commands')
    const row = within(dialog).getByRole('option', { name: /sidebar/i })
    expect(row.className).toContain('rounded-pill')
    expect(row.className).toContain('pointer-coarse:h-11')
    expect(within(row).getByText(/^(Ctrl B|⌘B)$/)).toBeTruthy()
  })

  it('names its groups in sentence case', async () => {
    const { user } = await renderApp('/t')
    await user.keyboard('{Control>}k{/Control}')
    const dialog = await screen.findByRole('dialog', { name: 'Command palette' })
    const headings = [...dialog.querySelectorAll('[cmdk-group-heading]')].map((h) => h.textContent)
    expect(headings).toEqual(['Go to', 'Appearance', 'Layout'])
  })

  it('hides and shows the sidebar from the palette', async () => {
    const { user } = await renderApp('/t')
    await user.keyboard('{Control>}k{/Control}')
    await user.click(await screen.findByRole('option', { name: /Hide sidebar/ }))
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Sidebar' })).toBeNull())
  })
})
