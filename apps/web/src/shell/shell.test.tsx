import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { renderApp, stubViewport } from '../test/render-app.tsx'

beforeEach(() => stubViewport(1440))

describe('app shell', () => {
  it('opens on Teammates', async () => {
    const { router } = await renderApp('/')
    await waitFor(() => expect(router.state.location.pathname).toBe('/t'))
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'Teammates' }).getAttribute('aria-current')).toBe(
      'page',
    )
  })

  it('has a labelled rail link for every main view', async () => {
    await renderApp('/t')
    const nav = screen.getByRole('navigation', { name: 'Main' })
    for (const name of ['Teammates', 'Activity', 'Approvals', 'Memory', 'Routines', 'Settings']) {
      expect(within(nav).getByRole('link', { name })).toBeTruthy()
    }
  })

  it('moves between views from the rail', async () => {
    const { user, router } = await renderApp('/t')
    const nav = screen.getByRole('navigation', { name: 'Main' })
    await user.click(within(nav).getByRole('link', { name: 'Activity' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/activity'))
    expect(screen.getByRole('heading', { level: 1, name: 'Activity' })).toBeTruthy()
    expect(within(nav).getByRole('link', { name: 'Activity' }).getAttribute('aria-current')).toBe(
      'page',
    )
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
    await user.click(screen.getByRole('button', { name: 'Hide side panel' }))
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Context' })).toBeNull())
    await user.click(screen.getByRole('button', { name: 'Show side panel' }))
    expect(screen.getByRole('complementary', { name: 'Context' })).toBeTruthy()
  })

  it('opens the context panel as a sheet below 1100 px', async () => {
    stubViewport(900)
    const { user } = await renderApp('/t')
    expect(screen.queryByRole('complementary', { name: 'Context' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Show side panel' }))
    const sheet = await screen.findByRole('dialog', { name: 'Context' })
    expect(within(sheet).getByRole('tab', { name: 'Computer' })).toBeTruthy()
  })

  it('switches context panel tabs', async () => {
    const { user } = await renderApp('/t')
    await user.click(screen.getByRole('tab', { name: 'Run' }))
    expect(screen.getByRole('tab', { name: 'Run' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('Run details show up while a teammate works.')).toBeTruthy()
  })
})
