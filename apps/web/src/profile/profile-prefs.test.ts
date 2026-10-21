import { describe, expect, it } from 'vitest'
import { CONTEXT_MAX, loadProfile, PROFILE_STORAGE_KEY, saveProfile } from './profile-prefs.ts'

function memoryStorage(initial?: string) {
  const data = new Map<string, string>()
  if (initial !== undefined) data.set(PROFILE_STORAGE_KEY, initial)
  return {
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

describe('profile prefs', () => {
  it('is empty when nothing is saved', () => {
    expect(loadProfile(memoryStorage())).toEqual({ name: '', context: '' })
  })

  it('round-trips a saved profile, trimming the name', () => {
    const storage = memoryStorage()
    saveProfile(storage, { name: '  Sam ', context: 'I run a bakery.' })
    expect(loadProfile(storage)).toEqual({ name: 'Sam', context: 'I run a bakery.' })
  })

  it('falls back to empty on junk, wrong shapes and blocked storage', () => {
    expect(loadProfile(memoryStorage('{nope'))).toEqual({ name: '', context: '' })
    expect(loadProfile(memoryStorage(JSON.stringify({ name: 4 })))).toEqual({
      name: '',
      context: '',
    })
    expect(loadProfile(throwing)).toEqual({ name: '', context: '' })
    expect(loadProfile(null)).toEqual({ name: '', context: '' })
  })

  it('does not throw when saving to blocked storage', () => {
    expect(() => saveProfile(throwing, { name: 'Sam', context: '' })).not.toThrow()
  })

  it('caps the context at its limit when saving', () => {
    const storage = memoryStorage()
    saveProfile(storage, { name: '', context: 'x'.repeat(CONTEXT_MAX + 50) })
    expect(loadProfile(storage).context).toHaveLength(CONTEXT_MAX)
  })
})
