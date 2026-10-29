import { describe, expect, it } from 'vitest'
import { applySplashAppearance, initialViewFrom } from './setup.ts'

describe('the splash setup', () => {
  it('opens the connect form only for ?connect', () => {
    expect(initialViewFrom('?connect')).toBe('connect')
    expect(initialViewFrom('?connect=')).toBe('connect')
    expect(initialViewFrom('')).toBe('main')
    expect(initialViewFrom('?demo=failed')).toBe('main')
  })

  it('wears the owner’s theme, palette and motion as the host last saw them in the app', () => {
    const root = document.createElement('html')
    applySplashAppearance(root, { theme: 'dark', palette: 'dracula', reduceMotion: true })
    expect(root.getAttribute('data-theme')).toBe('dark')
    expect(root.getAttribute('data-palette')).toBe('dracula')
    expect(root.classList.contains('reduce-motion')).toBe(true)
    // Attribute swaps only: tokens.css holds every palette, nothing is written inline.
    expect(root.getAttribute('style')).toBeNull()
  })

  it('keeps the defaults without a saved appearance, and Mawl without a palette', () => {
    const root = document.createElement('html')
    applySplashAppearance(root, null)
    expect(root.hasAttribute('data-theme')).toBe(false)
    expect(root.classList.contains('reduce-motion')).toBe(false)

    applySplashAppearance(root, { theme: 'system', palette: null, reduceMotion: false })
    expect(root.hasAttribute('data-theme')).toBe(false)
    expect(root.getAttribute('data-palette')).toBe('mawl')
  })
})
