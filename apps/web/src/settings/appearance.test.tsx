import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { APPEARANCE_STORAGE_KEY } from '../appearance/prefs.ts'
import { renderApp, stubViewport } from '../test/render-app.tsx'

const root = document.documentElement
const stored = () => JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? 'null')

beforeEach(() => stubViewport(1440))

describe('settings, appearance', () => {
  it('starts from the stored preferences', async () => {
    localStorage.setItem(
      APPEARANCE_STORAGE_KEY,
      JSON.stringify({ theme: 'dark', accent: '#8E6BE8', reduceMotion: true }),
    )
    await renderApp('/settings')
    expect(root.getAttribute('data-theme')).toBe('dark')
    expect(root.classList.contains('reduce-motion')).toBe(true)
    expect(screen.getByRole('radio', { name: 'Dark' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: 'Plum' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('switch', { name: 'Reduce motion' }).getAttribute('aria-checked')).toBe(
      'true',
    )
  })

  it('switches theme and remembers it', async () => {
    const { user } = await renderApp('/settings')
    expect(root.hasAttribute('data-theme')).toBe(false)
    await user.click(screen.getByRole('radio', { name: 'Dark' }))
    expect(root.getAttribute('data-theme')).toBe('dark')
    expect(stored().theme).toBe('dark')
    await user.click(screen.getByRole('radio', { name: 'System' }))
    expect(root.hasAttribute('data-theme')).toBe(false)
  })

  it('changes the accent from a preset swatch', async () => {
    const { user } = await renderApp('/settings')
    const before = root.style.getPropertyValue('--accent-light-accent')
    await user.click(screen.getByRole('radio', { name: 'Moss' }))
    expect(screen.getByRole('radio', { name: 'Moss' }).getAttribute('aria-checked')).toBe('true')
    expect(root.style.getPropertyValue('--accent-light-accent')).not.toBe(before)
    expect(stored().accent).toBe('#3FA36B')
  })

  it('accepts a custom accent color', async () => {
    await renderApp('/settings')
    fireEvent.change(screen.getByLabelText('Custom accent color'), {
      target: { value: '#12a4b0' },
    })
    expect(stored().accent).toBe('#12A4B0')
    expect(screen.getByRole('radio', { name: 'Lake' }).getAttribute('aria-checked')).toBe('false')
  })

  it('toggles reduced motion', async () => {
    const { user } = await renderApp('/settings')
    await user.click(screen.getByRole('switch', { name: 'Reduce motion' }))
    expect(root.classList.contains('reduce-motion')).toBe(true)
    expect(stored().reduceMotion).toBe(true)
  })
})
