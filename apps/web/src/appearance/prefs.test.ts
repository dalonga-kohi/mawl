import { PALETTE_IDS } from '@mawl/ui'
import { describe, expect, it } from 'vitest'
import {
  APPEARANCE_STORAGE_KEY,
  applyAppearance,
  DEFAULT_APPEARANCE,
  loadAppearance,
  saveAppearance,
} from './prefs.ts'

const memoryStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  }
}

const throwingStorage = {
  getItem: () => {
    throw new Error('SecurityError')
  },
  setItem: () => {
    throw new Error('QuotaExceededError')
  },
}

const loadFrom = (value: unknown) =>
  loadAppearance(memoryStorage({ [APPEARANCE_STORAGE_KEY]: JSON.stringify(value) }))

describe('loadAppearance', () => {
  it('defaults to the system theme, the Mawl palette and full motion', () => {
    expect(DEFAULT_APPEARANCE).toEqual({ theme: 'system', palette: 'mawl', reduceMotion: false })
    expect(loadAppearance(memoryStorage())).toEqual(DEFAULT_APPEARANCE)
  })

  it('falls back to defaults when storage is missing, throws or holds garbage', () => {
    expect(loadAppearance(null)).toEqual(DEFAULT_APPEARANCE)
    expect(loadAppearance(throwingStorage)).toEqual(DEFAULT_APPEARANCE)
    expect(loadAppearance(memoryStorage({ [APPEARANCE_STORAGE_KEY]: '{not json' }))).toEqual(
      DEFAULT_APPEARANCE,
    )
    expect(loadAppearance(memoryStorage({ [APPEARANCE_STORAGE_KEY]: '42' }))).toEqual(
      DEFAULT_APPEARANCE,
    )
    expect(loadFrom([1, 2])).toEqual(DEFAULT_APPEARANCE)
  })

  it('keeps each valid field and replaces only the invalid ones', () => {
    expect(loadFrom({ theme: 'dark', palette: 'nord', reduceMotion: 'yes' })).toEqual({
      theme: 'dark',
      palette: 'nord',
      reduceMotion: false,
    })
    expect(loadFrom({ theme: 'sepia', palette: 'dracula', reduceMotion: true })).toEqual({
      theme: 'system',
      palette: 'dracula',
      reduceMotion: true,
    })
  })

  it('reads every palette id', () => {
    for (const id of PALETTE_IDS) expect(loadFrom({ palette: id }).palette, id).toBe(id)
  })

  it('falls back to Mawl for an unknown, mis-cased or non-string palette', () => {
    for (const palette of ['solarized', 'Dracula', '', 7, null, { id: 'nord' }]) {
      expect(loadFrom({ theme: 'dark', palette }).palette, String(palette)).toBe('mawl')
    }
  })
})

describe('loadAppearance, migrating the retired accent', () => {
  it('moves any saved accent (preset, custom or retired) to Mawl and keeps the other fields', () => {
    for (const accent of ['#7950E8', '#A9D3F5', '#12A4B0', '#D8E88A', 'lime', 'sky']) {
      expect(loadFrom({ theme: 'dark', accent, reduceMotion: true }), accent).toEqual({
        theme: 'dark',
        palette: 'mawl',
        reduceMotion: true,
      })
    }
  })

  it('drops the accent field cleanly', () => {
    const loaded = loadFrom({ theme: 'light', accent: '#F7C4A3', palette: 'gruvbox' })
    expect(loaded).toEqual({ theme: 'light', palette: 'gruvbox', reduceMotion: false })
    expect('accent' in loaded).toBe(false)
  })
})

describe('saveAppearance', () => {
  it('round-trips through loadAppearance', () => {
    const storage = memoryStorage()
    const prefs = { theme: 'light', palette: 'rose-pine', reduceMotion: true } as const
    saveAppearance(storage, prefs)
    expect(loadAppearance(storage)).toEqual(prefs)
  })

  it('writes only theme, palette and motion, so a migrated record loses its accent', () => {
    const storage = memoryStorage({
      [APPEARANCE_STORAGE_KEY]: JSON.stringify({ theme: 'dark', accent: '#A9D3F5' }),
    })
    saveAppearance(storage, loadAppearance(storage))
    expect(JSON.parse(storage.data.get(APPEARANCE_STORAGE_KEY) ?? '')).toEqual({
      theme: 'dark',
      palette: 'mawl',
      reduceMotion: false,
    })
  })

  it('never throws when storage is unavailable', () => {
    expect(() => saveAppearance(throwingStorage, DEFAULT_APPEARANCE)).not.toThrow()
    expect(() => saveAppearance(null, DEFAULT_APPEARANCE)).not.toThrow()
  })
})

describe('applyAppearance', () => {
  it('leaves data-theme off for the system theme so the media query decides', () => {
    const root = document.createElement('div')
    root.setAttribute('data-theme', 'dark')
    applyAppearance(root, DEFAULT_APPEARANCE)
    expect(root.hasAttribute('data-theme')).toBe(false)
  })

  it('pins light or dark with data-theme', () => {
    const root = document.createElement('div')
    applyAppearance(root, { ...DEFAULT_APPEARANCE, theme: 'dark' })
    expect(root.getAttribute('data-theme')).toBe('dark')
    applyAppearance(root, { ...DEFAULT_APPEARANCE, theme: 'light' })
    expect(root.getAttribute('data-theme')).toBe('light')
  })

  it('sets data-palette, Mawl included, and writes no inline colors', () => {
    const root = document.createElement('div')
    applyAppearance(root, DEFAULT_APPEARANCE)
    expect(root.getAttribute('data-palette')).toBe('mawl')
    applyAppearance(root, { ...DEFAULT_APPEARANCE, palette: 'catppuccin' })
    expect(root.getAttribute('data-palette')).toBe('catppuccin')
    expect(root.getAttribute('style')).toBeNull()
  })

  it('falls back to Mawl for a palette that slipped past the types', () => {
    const root = document.createElement('div')
    // reason: simulates a value from outside the type system (a stale caller or the devtools).
    applyAppearance(root, { ...DEFAULT_APPEARANCE, palette: 'neon' as 'mawl' })
    expect(root.getAttribute('data-palette')).toBe('mawl')
  })

  it('toggles the reduce-motion class', () => {
    const root = document.createElement('div')
    applyAppearance(root, { ...DEFAULT_APPEARANCE, reduceMotion: true })
    expect(root.classList.contains('reduce-motion')).toBe(true)
    applyAppearance(root, DEFAULT_APPEARANCE)
    expect(root.classList.contains('reduce-motion')).toBe(false)
  })
})
