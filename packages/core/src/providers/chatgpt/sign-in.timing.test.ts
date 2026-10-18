import { beforeEach, describe, expect, it, vi } from 'vitest'

const compared = vi.hoisted(() => ({ lengths: [] as Array<[number, number]> }))

vi.mock('node:crypto', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:crypto')>()
  return {
    ...real,
    timingSafeEqual: (a: NodeJS.ArrayBufferView, b: NodeJS.ArrayBufferView) => {
      compared.lengths.push([a.byteLength, b.byteLength])
      return real.timingSafeEqual(a, b)
    },
  }
})

const { beginSignIn, stateMatches } = await import('./sign-in.ts')
const { HOST_ID } = await import('./test-util.ts')

beforeEach(() => {
  compared.lengths.length = 0
})

describe('state comparison is constant time', () => {
  const attempt = () =>
    beginSignIn({
      clientId: null,
      hostId: HOST_ID,
      port: 1455,
      random: (n) => new Uint8Array(n).fill(7),
    })

  it('compares the real state through timingSafeEqual, never with ===', () => {
    const a = attempt()
    expect(stateMatches(a, new URLSearchParams({ state: a.state }))).toBe(true)
    expect(compared.lengths).toEqual([[a.state.length, a.state.length]])
  })

  it('compares a wrong same-length state through timingSafeEqual too', () => {
    const a = attempt()
    const wrong = 'x'.repeat(a.state.length)
    expect(stateMatches(a, new URLSearchParams({ state: wrong }))).toBe(false)
    expect(compared.lengths).toHaveLength(1)
  })

  it('refuses a different-length state without ever handing mismatched buffers to timingSafeEqual', () => {
    const a = attempt()
    expect(stateMatches(a, new URLSearchParams({ state: 'short' }))).toBe(false)
    for (const [x, y] of compared.lengths) expect(x).toBe(y)
  })
})
