import { describe, expect, it } from 'vitest'
import { applySplashAppearance, initialViewFrom } from './setup.ts'

describe('the splash setup', () => {
  it('opens the connect form only for ?connect', () => {
    expect(initialViewFrom('?connect')).toBe('connect')
    expect(initialViewFrom('?connect=')).toBe('connect')
    expect(initialViewFrom('')).toBe('main')
    expect(initialViewFrom('?demo=failed')).toBe('main')
  })

  it('applies the owner’s theme, accent and motion from the host', () => {
    const root = document.createElement('html')
    applySplashAppearance(root, { theme: 'dark', accent: '#4F46E5', reduceMotion: true })
    expect(root.getAttribute('data-theme')).toBe('dark')
    expect(root.classList.contains('reduce-motion')).toBe(true)
    expect(root.style.length).toBeGreaterThan(0)
  })

  it('keeps the defaults without a saved appearance, and the default accent without one', () => {
    const root = document.createElement('html')
    applySplashAppearance(root, null)
    expect(root.hasAttribute('data-theme')).toBe(false)
    expect(root.classList.contains('reduce-motion')).toBe(false)

    applySplashAppearance(root, { theme: 'system', accent: null, reduceMotion: false })
    expect(root.hasAttribute('data-theme')).toBe(false)
    expect(root.style.length).toBeGreaterThan(0)
  })
})
