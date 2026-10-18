import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RouteError, RoutePending } from './route-fallbacks.tsx'

describe('route fallbacks', () => {
  it('says a page failed to load and retries it', async () => {
    const reset = vi.fn()
    render(
      <RouteError error={new Error('Failed to fetch dynamically imported module')} reset={reset} />,
    )
    expect(screen.getByRole('heading', { name: "This page didn't load" })).toBeTruthy()
    // The raw error is for developers; the owner gets what to do instead.
    expect(screen.queryByText(/dynamically imported/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(reset).toHaveBeenCalledOnce()
  })

  it('shows a busy skeleton while a page loads', () => {
    render(<RoutePending />)
    expect(screen.getByRole('status', { name: 'Loading' }).getAttribute('aria-busy')).toBe('true')
  })
})
