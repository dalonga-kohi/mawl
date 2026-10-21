import { RunErrorCode, RunStatus } from '@mawl/contracts'
import { describe, expect, it } from 'vitest'
import { failureCopy, isActive, statusLine } from './run-copy.ts'

describe('run copy', () => {
  it('explains every run error code with a title and a fix', () => {
    const titles = new Set<string>()
    for (const code of RunErrorCode.options) {
      const copy = failureCopy(code)
      expect(copy.title.length, code).toBeGreaterThan(0)
      expect(copy.hint.length, code).toBeGreaterThan(0)
      titles.add(copy.title)
    }
    // Each code says something specific, not one generic line.
    expect(titles.size).toBe(RunErrorCode.options.length)
  })

  it('falls back to a server error line when the code is missing', () => {
    expect(failureCopy(null).title).toMatch(/Mawl server/)
  })

  it('treats only succeeded, failed and cancelled as finished', () => {
    const finished = RunStatus.options.filter((s) => !isActive(s))
    expect(finished).toEqual(['succeeded', 'failed', 'cancelled'])
    expect(isActive(undefined)).toBe(false)
  })

  it('says whether a running teammate is thinking or writing', () => {
    expect(statusLine('running', false)).toBe('Thinking')
    expect(statusLine('running', true)).toBe('Writing')
    expect(statusLine('queued', false)).toBe('Getting started')
    expect(statusLine(undefined, false)).toBe('Ready')
    expect(statusLine('succeeded', false)).toBe('Ready')
  })
})
