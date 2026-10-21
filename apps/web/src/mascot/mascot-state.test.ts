import { describe, expect, it } from 'vitest'
import { deriveMascotState } from './mascot-state.ts'
import { MASCOT_STATES } from './states.ts'

describe('MASCOT_STATES', () => {
  it('lists the eight Mawl states from UI-REDESIGN §4', () => {
    expect([...MASCOT_STATES].sort()).toEqual(
      ['done', 'idle', 'listening', 'oops', 'sleepy', 'thinking', 'waiting', 'working'].sort(),
    )
  })
})

describe('deriveMascotState', () => {
  it('rests when nothing happens and listens while the owner types', () => {
    expect(deriveMascotState({})).toBe('idle')
    expect(deriveMascotState({ typing: true })).toBe('listening')
  })

  it('thinks while a run starts or generates, and works while tools run', () => {
    expect(deriveMascotState({ run: 'queued' })).toBe('thinking')
    expect(deriveMascotState({ run: 'running' })).toBe('thinking')
    expect(deriveMascotState({ run: 'running', toolsRunning: true })).toBe('working')
    expect(deriveMascotState({ run: 'compacting' })).toBe('working')
  })

  it('waits when the run needs the owner', () => {
    for (const run of ['waiting_approval', 'waiting_takeover', 'waiting_user'] as const) {
      expect(deriveMascotState({ run })).toBe('waiting')
    }
  })

  it('celebrates or droops right after a run ends, then settles', () => {
    expect(deriveMascotState({ run: 'succeeded', justEnded: true })).toBe('done')
    expect(deriveMascotState({ run: 'failed', justEnded: true })).toBe('oops')
    expect(deriveMascotState({ run: 'succeeded' })).toBe('idle')
    expect(deriveMascotState({ run: 'failed' })).toBe('idle')
    expect(deriveMascotState({ run: 'cancelled', justEnded: true })).toBe('idle')
  })

  it('an active run outranks typing', () => {
    expect(deriveMascotState({ run: 'running', typing: true })).toBe('thinking')
  })

  it('gets sleepy when paused', () => {
    expect(deriveMascotState({ run: 'paused' })).toBe('sleepy')
  })
})
