import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { renderApp, stubViewport } from '../test/render-app.tsx'

beforeEach(() => stubViewport(1440))

describe('tools page', () => {
  it('is a calm placeholder that points to connections', async () => {
    const { user, router } = await renderApp('/tools')
    expect(await screen.findByRole('heading', { level: 1, name: 'Tools' })).toBeTruthy()
    expect(screen.getByText('Connections, skills and plugins live here soon.')).toBeTruthy()
    await user.click(screen.getByRole('link', { name: 'Open connections' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/connections'))
  })
})
