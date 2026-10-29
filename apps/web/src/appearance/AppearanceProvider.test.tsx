import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppearanceProvider, COLOR_SWAP_MS, useAppearance } from './AppearanceProvider.tsx'
import { APPEARANCE_STORAGE_KEY } from './prefs.ts'

const root = document.documentElement
let api: ReturnType<typeof useAppearance>

function Probe() {
  api = useAppearance()
  return null
}

const mount = () =>
  render(
    <AppearanceProvider>
      <Probe />
    </AppearanceProvider>,
  )

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  root.classList.remove('color-swap')
})

describe('AppearanceProvider', () => {
  it('sets data-palette and data-theme from the stored choice before paint', () => {
    localStorage.setItem(
      APPEARANCE_STORAGE_KEY,
      JSON.stringify({ theme: 'dark', palette: 'dracula', reduceMotion: false }),
    )
    mount()
    expect(root.getAttribute('data-palette')).toBe('dracula')
    expect(root.getAttribute('data-theme')).toBe('dark')
  })

  it('migrates an old accent record to Mawl and rewrites storage without it', () => {
    localStorage.setItem(
      APPEARANCE_STORAGE_KEY,
      JSON.stringify({ theme: 'light', accent: '#A9D3F5', reduceMotion: true }),
    )
    mount()
    expect(root.getAttribute('data-palette')).toBe('mawl')
    expect(JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? '')).toEqual({
      theme: 'light',
      palette: 'mawl',
      reduceMotion: true,
    })
  })

  it('switches palette and theme, and persists both', () => {
    mount()
    act(() => api.setPalette('nord'))
    expect(root.getAttribute('data-palette')).toBe('nord')
    act(() => api.setTheme('dark'))
    expect(root.getAttribute('data-theme')).toBe('dark')
    expect(JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? '')).toMatchObject({
      theme: 'dark',
      palette: 'nord',
    })
  })

  it('ignores a palette id it does not know', () => {
    mount()
    // reason: a caller outside the type system (the command palette's string, say).
    act(() => api.setPalette('neon' as 'mawl'))
    expect(api.appearance.palette).toBe('mawl')
    expect(root.getAttribute('data-palette')).toBe('mawl')
  })

  it('tweens colors only while a palette or theme change lands, never on first paint', () => {
    mount()
    expect(root.classList.contains('color-swap')).toBe(false)
    act(() => api.setPalette('gruvbox'))
    expect(root.classList.contains('color-swap')).toBe(true)
    act(() => vi.advanceTimersByTime(COLOR_SWAP_MS + 20))
    expect(root.classList.contains('color-swap')).toBe(false)
    act(() => api.setTheme('light'))
    expect(root.classList.contains('color-swap')).toBe(true)
  })

  it('does not tween for the motion toggle', () => {
    mount()
    act(() => api.setReduceMotion(true))
    expect(root.classList.contains('color-swap')).toBe(false)
  })

  it('restarts the tween window when changes come quickly', () => {
    mount()
    act(() => api.setPalette('claude'))
    act(() => vi.advanceTimersByTime(COLOR_SWAP_MS - 50))
    act(() => api.setPalette('nord'))
    act(() => vi.advanceTimersByTime(COLOR_SWAP_MS - 50))
    expect(root.classList.contains('color-swap')).toBe(true)
    act(() => vi.advanceTimersByTime(100))
    expect(root.classList.contains('color-swap')).toBe(false)
  })
})
