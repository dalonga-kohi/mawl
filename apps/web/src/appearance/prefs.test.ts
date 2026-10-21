import { accentPresets, defaultAccent, retiredAccentPresets } from '@mawl/ui'
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

describe('loadAppearance', () => {
  it('defaults to the system theme, the Lime accent and full motion', () => {
    expect(DEFAULT_APPEARANCE).toEqual({
      theme: 'system',
      accent: defaultAccent.hex,
      reduceMotion: false,
    })
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
  })

  it('keeps each valid field and replaces only the invalid ones', () => {
    const stored = JSON.stringify({ theme: 'dark', accent: 'red', reduceMotion: 'yes' })
    expect(loadAppearance(memoryStorage({ [APPEARANCE_STORAGE_KEY]: stored }))).toEqual({
      theme: 'dark',
      accent: defaultAccent.hex,
      reduceMotion: false,
    })
  })

  it('rejects a theme outside system, light and dark', () => {
    const stored = JSON.stringify({ theme: 'sepia', accent: '#12A4B0', reduceMotion: true })
    expect(loadAppearance(memoryStorage({ [APPEARANCE_STORAGE_KEY]: stored }))).toEqual({
      theme: 'system',
      accent: '#12A4B0',
      reduceMotion: true,
    })
  })
})

describe('loadAppearance, retired accent presets', () => {
  const load = (accent: unknown) =>
    loadAppearance(
      memoryStorage({
        [APPEARANCE_STORAGE_KEY]: JSON.stringify({ theme: 'dark', accent, reduceMotion: true }),
      }),
    ).accent

  it('moves a saved retired preset color (any case) to Lime and keeps the other fields', () => {
    for (const p of retiredAccentPresets) {
      expect(load(p.hex), p.name).toBe(defaultAccent.hex)
      expect(load(p.hex.toLowerCase()), p.name).toBe(defaultAccent.hex)
    }
    const stored = JSON.stringify({ theme: 'dark', accent: '#3D8BFD', reduceMotion: true })
    expect(loadAppearance(memoryStorage({ [APPEARANCE_STORAGE_KEY]: stored }))).toEqual({
      theme: 'dark',
      accent: defaultAccent.hex,
      reduceMotion: true,
    })
  })

  it('moves a saved retired preset name or id to Lime', () => {
    for (const value of ['lake', 'Lake', 'moss', 'Amber', 'coral', 'plum']) {
      expect(load(value), value).toBe(defaultAccent.hex)
    }
  })

  it('resolves a saved current preset name or id to its color', () => {
    const sky = accentPresets.find((p) => p.id === 'sky')
    expect(load('sky')).toBe(sky?.hex)
    expect(load('Sky')).toBe(sky?.hex)
  })

  it('keeps a saved custom color and every current preset color', () => {
    expect(load('#12a4b0')).toBe('#12A4B0')
    for (const p of accentPresets) expect(load(p.hex), p.name).toBe(p.hex)
  })
})

describe('saveAppearance', () => {
  it('round-trips through loadAppearance', () => {
    const storage = memoryStorage()
    const prefs = { theme: 'light', accent: '#CBB9F4', reduceMotion: true } as const
    saveAppearance(storage, prefs)
    expect(loadAppearance(storage)).toEqual(prefs)
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

  it('writes both accent scales so a theme flip needs no JavaScript', () => {
    const root = document.createElement('div')
    const sky = accentPresets.find((p) => p.id === 'sky')
    applyAppearance(root, { ...DEFAULT_APPEARANCE, accent: sky?.hex ?? '' })
    expect(root.style.getPropertyValue('--accent-light-accent')).not.toBe('')
    expect(root.style.getPropertyValue('--accent-dark-fill')).not.toBe('')
  })

  it('toggles the reduce-motion class', () => {
    const root = document.createElement('div')
    applyAppearance(root, { ...DEFAULT_APPEARANCE, reduceMotion: true })
    expect(root.classList.contains('reduce-motion')).toBe(true)
    applyAppearance(root, DEFAULT_APPEARANCE)
    expect(root.classList.contains('reduce-motion')).toBe(false)
  })
})
