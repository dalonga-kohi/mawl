import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { renderApp, stubViewport } from '../test/render-app.tsx'

beforeEach(() => stubViewport(1440))

describe('scheduled page', () => {
  it('explains the empty timetable and points to a chat', async () => {
    const { user, router } = await renderApp('/routines')
    expect(await screen.findByRole('heading', { level: 1, name: 'Scheduled' })).toBeTruthy()
    expect(screen.getByText('Things your teammates do on their own, on a timetable.')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'Nothing scheduled yet' })).toBeTruthy()
    expect(
      screen.getByText('Ask a teammate to do something every morning and it will show up here.'),
    ).toBeTruthy()
    await user.click(screen.getByRole('link', { name: 'Open a chat' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/t'))
  })
})
