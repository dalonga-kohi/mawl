import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { APPEARANCE_STORAGE_KEY } from '../appearance/prefs.ts'
import { renderApp, stubViewport } from '../test/render-app.tsx'

const root = document.documentElement
const stored = () => JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? 'null')
const palettes = () => screen.getByRole('radiogroup', { name: 'Palette' })
const tile = (name: string) => within(palettes()).getByRole('radio', { name })

beforeEach(() => stubViewport(1440))

describe('settings, appearance', () => {
  it('starts from the stored preferences', async () => {
    localStorage.setItem(
      APPEARANCE_STORAGE_KEY,
      JSON.stringify({ theme: 'dark', palette: 'gruvbox', reduceMotion: true }),
    )
    await renderApp('/settings')
    expect(root.getAttribute('data-theme')).toBe('dark')
    expect(root.getAttribute('data-palette')).toBe('gruvbox')
    expect(root.classList.contains('reduce-motion')).toBe(true)
    expect(screen.getByRole('radio', { name: 'Dark' }).getAttribute('aria-checked')).toBe('true')
    expect(tile('Gruvbox').getAttribute('aria-checked')).toBe('true')
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

  it('shows the seven palettes as a radio group with Mawl selected by default', async () => {
    await renderApp('/settings')
    const radios = within(palettes()).getAllByRole('radio')
    expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual([
      'Mawl',
      'Dracula',
      'Catppuccin',
      'Gruvbox',
      'Claude',
      'Rosé Pine',
      'Nord',
    ])
    expect(radios.filter((r) => r.getAttribute('aria-checked') === 'true')).toEqual([tile('Mawl')])
  })

  it('draws each tile preview in its own palette and the current theme', async () => {
    localStorage.setItem(
      APPEARANCE_STORAGE_KEY,
      JSON.stringify({ theme: 'dark', palette: 'mawl', reduceMotion: false }),
    )
    await renderApp('/settings')
    const preview = tile('Nord').querySelector('[data-palette]')
    expect(preview?.getAttribute('data-palette')).toBe('nord')
    expect(preview?.getAttribute('data-theme')).toBe('dark')
    expect(preview?.getAttribute('aria-hidden')).toBe('true')
  })

  it('draws previews from base tokens only, never the html-computed color-mix ones', async () => {
    await renderApp('/settings')
    for (const preview of palettes().querySelectorAll('[data-palette]')) {
      expect(preview.outerHTML).not.toMatch(/-(soft|softer|ring)\b/)
    }
  })

  it('leaves the tile theme to the system when the theme follows it', async () => {
    await renderApp('/settings')
    const preview = tile('Claude').querySelector('[data-palette]')
    expect(preview?.getAttribute('data-palette')).toBe('claude')
    expect(preview?.hasAttribute('data-theme')).toBe(false)
  })

  it('recolors the app on click, confirms it and remembers it', async () => {
    const { user } = await renderApp('/settings')
    await user.click(tile('Dracula'))
    expect(root.getAttribute('data-palette')).toBe('dracula')
    expect(tile('Dracula').getAttribute('aria-checked')).toBe('true')
    expect(tile('Mawl').getAttribute('aria-checked')).toBe('false')
    expect(stored().palette).toBe('dracula')
    expect(
      within(palettes().parentElement as HTMLElement).getByText('Dracula on. Saved.'),
    ).toBeTruthy()
  })

  it('moves through the palettes with the arrow keys', async () => {
    const { user } = await renderApp('/settings')
    tile('Mawl').focus()
    // Radix checks the focused radio while the arrow is held, as a real key press does.
    await user.keyboard('{ArrowRight>}')
    await waitFor(() => expect(root.getAttribute('data-palette')).toBe('dracula'))
    expect(document.activeElement).toBe(tile('Dracula'))
    await user.keyboard('{/ArrowRight}{ArrowLeft>}')
    await waitFor(() => expect(document.activeElement).toBe(tile('Mawl')))
    await user.keyboard('{/ArrowLeft}{ArrowLeft>}')
    await waitFor(() => expect(stored().palette).toBe('nord'))
    expect(document.activeElement).toBe(tile('Nord'))
    await user.keyboard('{/ArrowLeft}')
  })

  it('has no custom color picker any more', async () => {
    await renderApp('/settings')
    expect(screen.queryByLabelText('Custom accent color')).toBeNull()
    expect(screen.queryByRole('radiogroup', { name: 'Accent color' })).toBeNull()
  })

  it('toggles reduced motion', async () => {
    const { user } = await renderApp('/settings')
    await user.click(screen.getByRole('switch', { name: 'Reduce motion' }))
    expect(root.classList.contains('reduce-motion')).toBe(true)
    expect(stored().reduceMotion).toBe(true)
  })
})
