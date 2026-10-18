import { accentPresets, defaultAccent } from '@faire/ui'
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
  it('defaults to the system theme, the Lake accent and full motion', () => {
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
    const stored = JSON.stringify({ theme: 'sepia', accent: '#3FA36B', reduceMotion: true })
    expect(loadAppearance(memoryStorage({ [APPEARANCE_STORAGE_KEY]: stored }))).toEqual({
      theme: 'system',
      accent: '#3FA36B',
      reduceMotion: true,
    })
  })
})

describe('saveAppearance', () => {
  it('round-trips through loadAppearance', () => {
    const storage = memoryStorage()
    const prefs = { theme: 'light', accent: '#8E6BE8', reduceMotion: true } as const
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
    const moss = accentPresets.find((p) => p.id === 'moss')
    applyAppearance(root, { ...DEFAULT_APPEARANCE, accent: moss?.hex ?? '' })
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
