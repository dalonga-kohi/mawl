import { describe, expect, it } from 'vitest'
import {
  CONTEXT_MAX,
  isMigrated,
  loadProfile,
  markMigrated,
  PROFILE_STORAGE_KEY,
  saveProfile,
} from './profile-prefs.ts'

function memoryStorage(initial?: string) {
  const data = new Map<string, string>()
  if (initial !== undefined) data.set(PROFILE_STORAGE_KEY, initial)
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  }
}

const throwing = {
  getItem: () => {
    throw new Error('blocked')
  },
  setItem: () => {
    throw new Error('blocked')
  },
}

const empty = { name: '', personalContext: '' }

describe('profile cache', () => {
  it('is empty when nothing is saved', () => {
    expect(loadProfile(memoryStorage())).toEqual(empty)
  })

  it('round-trips a saved profile, trimming the name', () => {
    const storage = memoryStorage()
    saveProfile(storage, { name: '  Sam ', personalContext: 'I run a bakery.' })
    expect(loadProfile(storage)).toEqual({ name: 'Sam', personalContext: 'I run a bakery.' })
  })

  it('keeps the pre-server stored shape, so an old browser copy still reads', () => {
    const storage = memoryStorage(JSON.stringify({ name: 'Sam', context: 'Bakery.' }))
    expect(loadProfile(storage)).toEqual({ name: 'Sam', personalContext: 'Bakery.' })
    saveProfile(storage, { name: 'Ada', personalContext: 'Lab.' })
    expect(JSON.parse(storage.data.get(PROFILE_STORAGE_KEY) ?? '')).toEqual({
      name: 'Ada',
      context: 'Lab.',
    })
  })

  it('falls back to empty on junk, wrong shapes and blocked storage', () => {
    expect(loadProfile(memoryStorage('{nope'))).toEqual(empty)
    expect(loadProfile(memoryStorage(JSON.stringify({ name: 4 })))).toEqual(empty)
    expect(loadProfile(throwing)).toEqual(empty)
    expect(loadProfile(null)).toEqual(empty)
  })

  it('does not throw when saving to blocked storage', () => {
    expect(() => saveProfile(throwing, { name: 'Sam', personalContext: '' })).not.toThrow()
    expect(() => markMigrated(throwing)).not.toThrow()
    expect(isMigrated(throwing)).toBe(false)
  })

  it('caps the context at its limit when saving', () => {
    const storage = memoryStorage()
    saveProfile(storage, { name: '', personalContext: 'x'.repeat(CONTEXT_MAX + 50) })
    expect(loadProfile(storage).personalContext).toHaveLength(CONTEXT_MAX)
  })

  it('remembers that the browser copy was moved to the server', () => {
    const storage = memoryStorage()
    expect(isMigrated(storage)).toBe(false)
    markMigrated(storage)
    expect(isMigrated(storage)).toBe(true)
  })
})
