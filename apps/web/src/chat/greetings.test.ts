import { afterEach, describe, expect, it, vi } from 'vitest'
import { GREETINGS, greetingFor, resetSessionGreeting } from './greetings.ts'

afterEach(() => {
  resetSessionGreeting()
  vi.restoreAllMocks()
})

describe('greetings', () => {
  it('has six to eight lines, some with the name', () => {
    expect(GREETINGS.length).toBeGreaterThanOrEqual(6)
    expect(GREETINGS.length).toBeLessThanOrEqual(8)
    expect(GREETINGS.some((g) => g.includes('{name}'))).toBe(true)
    expect(GREETINGS.some((g) => !g.includes('{name}'))).toBe(true)
  })

  it('puts the first name into the line', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    expect(greetingFor('Sam Rivera')).toBe("What's next, Sam?")
  })

  it('drops the name cleanly when the owner has none', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    expect(greetingFor('  ')).toBe("What's next?")
  })

  it('never leaves a placeholder or a stray comma in any line', () => {
    for (let i = 0; i < GREETINGS.length; i++) {
      resetSessionGreeting()
      vi.spyOn(Math, 'random').mockReturnValue(i / GREETINGS.length)
      for (const name of ['', 'Sam']) {
        const line = greetingFor(name)
        expect(line).not.toMatch(/[{}]/)
        expect(line).not.toMatch(/,\s*[?!.]/)
        expect(line).not.toMatch(/\s{2,}/)
      }
      vi.restoreAllMocks()
    }
  })

  it('picks once per session and keeps the same line on every call', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const first = greetingFor('Sam')
    random.mockReturnValue(0.99)
    expect(greetingFor('Sam')).toBe(first)
    expect(random).toHaveBeenCalledTimes(1)
  })

  it('picks a new line after a reset', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    const first = greetingFor('Sam')
    resetSessionGreeting()
    random.mockReturnValue(0.99)
    expect(greetingFor('Sam')).not.toBe(first)
  })
})
