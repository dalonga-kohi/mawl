import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { renderApp, stubViewport } from '../test/render-app.tsx'

beforeEach(() => stubViewport(1440))

const selected = () =>
  screen
    .getAllByRole('tab')
    .filter((t) => t.getAttribute('aria-selected') === 'true')
    .map((t) => t.textContent)

describe('approvals page', () => {
  it('opens on Needs you, all caught up', async () => {
    await renderApp('/approvals')
    expect(await screen.findByRole('heading', { level: 1, name: 'Approvals' })).toBeTruthy()
    expect(screen.getByText('Decisions your teammates are waiting on.')).toBeTruthy()
    expect(selected()).toEqual(['Needs you'])
    expect(screen.getByRole('heading', { level: 2, name: "You're all caught up" })).toBeTruthy()
    expect(screen.getByText('When a teammate needs your OK, it appears here.')).toBeTruthy()
  })

  it('switches to Activity and keeps the tab in the URL', async () => {
    const { user, router } = await renderApp('/approvals')
    await user.click(await screen.findByRole('tab', { name: 'Activity' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'activity' }))
    expect(screen.getByRole('heading', { level: 2, name: 'No activity yet' })).toBeTruthy()
    expect(
      screen.getByText('What your teammates do shows up here, in plain sentences.'),
    ).toBeTruthy()
    await user.click(screen.getByRole('tab', { name: 'Needs you' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'needs-you' }))
  })

  it('falls back to Needs you for an unknown tab', async () => {
    await renderApp('/approvals?tab=whatever')
    await screen.findByRole('heading', { level: 1, name: 'Approvals' })
    expect(selected()).toEqual(['Needs you'])
  })

  it('redirects /activity to the Activity tab', async () => {
    const { router } = await renderApp('/activity')
    await waitFor(() => expect(router.state.location.pathname).toBe('/approvals'))
    expect(router.state.location.search).toEqual({ tab: 'activity' })
    expect(selected()).toEqual(['Activity'])
  })
})
