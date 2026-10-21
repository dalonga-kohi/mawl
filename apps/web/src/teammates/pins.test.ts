import { describe, expect, it } from 'vitest'
import { loadPinned, PINNED_STORAGE_KEY, savePinned, togglePinned } from './pins.ts'

const store = (initial?: string) => {
  const data = new Map<string, string>()
  if (initial !== undefined) data.set(PINNED_STORAGE_KEY, initial)
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  }
}
const blocked = {
  getItem: () => {
    throw new Error('blocked')
  },
  setItem: () => {
    throw new Error('blocked')
  },
}

describe('pinned teammates', () => {
  it('starts empty', () => {
    expect(loadPinned(store())).toEqual([])
  })

  it('round-trips ids', () => {
    const s = store()
    savePinned(s, ['prf_a', 'prf_b'])
    expect(loadPinned(s)).toEqual(['prf_a', 'prf_b'])
  })

  it('ignores junk and survives blocked storage', () => {
    expect(loadPinned(store('{"a":1}'))).toEqual([])
    expect(loadPinned(store('nope'))).toEqual([])
    expect(loadPinned(blocked)).toEqual([])
    expect(() => savePinned(blocked, ['x'])).not.toThrow()
  })

  it('toggles an id in and out, newest pin last', () => {
    expect(togglePinned(['a'], 'b')).toEqual(['a', 'b'])
    expect(togglePinned(['a', 'b'], 'a')).toEqual(['b'])
  })
})
