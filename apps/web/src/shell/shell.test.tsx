import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { renderApp, stubViewport } from '../test/render-app.tsx'

beforeEach(() => stubViewport(1440))

describe('app shell', () => {
  it('opens on Teammates', async () => {
    const { router } = await renderApp('/')
    await waitFor(() => expect(router.state.location.pathname).toBe('/t'))
    expect(await screen.findByRole('heading', { name: 'No teammates yet' })).toBeTruthy()
  })

  it('moves between views from the sidebar', async () => {
    const { user, router } = await renderApp('/t')
    const nav = screen.getByRole('navigation', { name: 'Main' })
    await user.click(within(nav).getByRole('link', { name: 'Scheduled' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/routines'))
    expect(screen.getByRole('heading', { level: 1, name: 'Scheduled' })).toBeTruthy()
    expect(within(nav).getByRole('link', { name: 'Scheduled' }).getAttribute('aria-current')).toBe(
      'page',
    )
  })

  it('keeps Memory reachable by address', async () => {
    await renderApp('/memory')
    expect(screen.getByRole('heading', { level: 1, name: 'Memory' })).toBeTruthy()
  })

  it('shows a not-found page with a way back for unknown paths', async () => {
    const { user, router } = await renderApp('/nowhere')
    expect(screen.getByRole('heading', { level: 1, name: 'Nothing lives here' })).toBeTruthy()
    await user.click(screen.getByRole('link', { name: 'Go to Teammates' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/t'))
  })
})
describe('teammates view', () => {
  it('points a fresh install to connecting a model', async () => {
    const { user, router } = await renderApp('/t')
    expect(await screen.findByRole('heading', { name: 'No teammates yet' })).toBeTruthy()
    await user.click(screen.getByRole('link', { name: 'Connect a model' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'))
  })

  it('collapses and restores the context panel on wide screens', async () => {
    const { user } = await renderApp('/t')
    expect(screen.getByRole('complementary', { name: 'Context' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Hide computer panel' }))
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Context' })).toBeNull())
    await user.click(screen.getByRole('button', { name: 'Show computer panel' }))
    expect(screen.getByRole('complementary', { name: 'Context' })).toBeTruthy()
  })

  it('opens the context panel as a sheet below 1100 px', async () => {
    stubViewport(900)
    const { user } = await renderApp('/t')
    expect(screen.queryByRole('complementary', { name: 'Context' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Show computer panel' }))
    const sheet = await screen.findByRole('dialog', { name: 'Context' })
    expect(within(sheet).getByRole('tab', { name: 'Computer' })).toBeTruthy()
  })

  it('shows a calm monitor tile, not the mascot, in the empty computer panel', async () => {
    await renderApp('/t')
    const panel = screen.getByRole('complementary', { name: 'Context' })
    expect(within(panel).getByText('The computer starts when a teammate needs it.')).toBeTruthy()
    expect(panel.querySelector('.mawl')).toBeNull()
    expect(panel.querySelector('[data-slot="icon-tile"]')).toBeTruthy()
  })

  it('switches context panel tabs, each with a calm empty state and no title row', async () => {
    const { user } = await renderApp('/t')
    const panel = screen.getByRole('complementary', { name: 'Context' })
    expect(within(panel).queryByRole('heading', { level: 1 })).toBeNull()

    await user.click(screen.getByRole('tab', { name: 'Memory' }))
    expect(screen.getByRole('heading', { name: 'Nothing remembered yet' })).toBeTruthy()
    expect(screen.getByText('What this teammate learns about you shows up here.')).toBeTruthy()
    expect(panel.querySelector('[data-slot="icon-tile"]')).toBeTruthy()

    await user.click(screen.getByRole('tab', { name: 'Run' }))
    expect(screen.getByRole('tab', { name: 'Run' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('heading', { name: 'No run yet' })).toBeTruthy()
    expect(panel.querySelector('.mawl')).toBeNull()
  })

  it('remembers a hidden context panel for next time', async () => {
    const first = await renderApp('/t')
    await first.user.click(screen.getByRole('button', { name: 'Hide computer panel' }))
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Context' })).toBeNull())
    expect(localStorage.getItem('mawl.panel')).toBe('closed')
    first.unmount()

    const again = await renderApp('/t')
    expect(screen.queryByRole('complementary', { name: 'Context' })).toBeNull()
    await again.user.click(screen.getByRole('button', { name: 'Show computer panel' }))
    expect(screen.getByRole('complementary', { name: 'Context' })).toBeTruthy()
    expect(localStorage.getItem('mawl.panel')).toBe('open')
  })

  it('does not remember the sheet below 1100 px', async () => {
    stubViewport(900)
    const { user } = await renderApp('/t')
    await user.click(screen.getByRole('button', { name: 'Show computer panel' }))
    await screen.findByRole('dialog', { name: 'Context' })
    expect(localStorage.getItem('mawl.panel')).toBeNull()
  })
})
