import { describe, expect, it } from 'vitest'
import { applySplashAppearance, initialViewFrom } from './setup.ts'

describe('the splash setup', () => {
  it('opens the connect form only for ?connect', () => {
    expect(initialViewFrom('?connect')).toBe('connect')
    expect(initialViewFrom('?connect=')).toBe('connect')
    expect(initialViewFrom('')).toBe('main')
    expect(initialViewFrom('?demo=failed')).toBe('main')
  })

  it('applies the owner’s theme and motion from the host, in the Mawl palette', () => {
    const root = document.createElement('html')
    applySplashAppearance(root, { theme: 'dark', accent: '#4F46E5', reduceMotion: true })
    expect(root.getAttribute('data-theme')).toBe('dark')
    expect(root.classList.contains('reduce-motion')).toBe(true)
    // The host does not carry the palette yet (U14), so the splash wears Mawl.
    expect(root.getAttribute('data-palette')).toBe('mawl')
    expect(root.getAttribute('style')).toBeNull()
  })

  it('keeps the defaults without a saved appearance, and Mawl without a palette', () => {
    const root = document.createElement('html')
    applySplashAppearance(root, null)
    expect(root.hasAttribute('data-theme')).toBe(false)
    expect(root.classList.contains('reduce-motion')).toBe(false)

    applySplashAppearance(root, { theme: 'system', accent: null, reduceMotion: false })
    expect(root.hasAttribute('data-theme')).toBe(false)
    expect(root.getAttribute('data-palette')).toBe('mawl')
  })
})
