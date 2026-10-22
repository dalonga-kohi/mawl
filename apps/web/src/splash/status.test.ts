import { expect, describe as group, it } from 'vitest'
import { describe, INITIAL_STATUS, parseStatus } from './status.ts'

group('supervisor status', () => {
  it('parses what the Rust supervisor sends', () => {
    expect(parseStatus({ phase: 'starting', stage: 'server' })).toEqual({
      phase: 'starting',
      stage: 'server',
    })
    expect(
      parseStatus({
        phase: 'restarting',
        attempt: 2,
        reason: { kind: 'exited', code: 1 },
        retry_in_ms: 2000,
      }),
    ).toMatchObject({ phase: 'restarting', attempt: 2 })
    expect(parseStatus({ phase: 'failed', reason: { kind: 'not_installed' } })).toEqual({
      phase: 'failed',
      reason: { kind: 'not_installed' },
    })
  })

  it('falls back to the starting screen for anything it does not know', () => {
    expect(parseStatus({ phase: 'exploded' })).toEqual(INITIAL_STATUS)
    expect(parseStatus(null)).toEqual(INITIAL_STATUS)
    expect(parseStatus({ phase: 'failed', reason: { kind: 'meteor' } })).toEqual(INITIAL_STATUS)
  })

  it('walks the progress track through the real boot stages', () => {
    expect(describe({ phase: 'starting', stage: 'database' })).toMatchObject({
      title: 'Waking up',
      detail: 'Starting the database',
      done: 0,
      active: true,
    })
    expect(describe({ phase: 'starting', stage: 'server' })).toMatchObject({
      done: 1,
      active: true,
    })
    expect(describe({ phase: 'ready' })).toMatchObject({ done: 3, mascot: 'done' })
  })

  it('says why a restart happens and which try it is', () => {
    const view = describe({
      phase: 'restarting',
      attempt: 3,
      reason: { kind: 'unhealthy' },
      retry_in_ms: 4000,
    })
    expect(view.title).toBe('Restarting')
    expect(view.detail).toContain('lost its database')
    expect(view.detail).toContain('try 3 of 5')
  })

  it('tells a missing install apart from a server that keeps failing', () => {
    const missing = describe({ phase: 'failed', reason: { kind: 'not_installed' } })
    expect(missing.failed).toBe(true)
    expect(missing.detail).toContain('Reinstall Mawl')
    const crashing = describe({ phase: 'failed', reason: { kind: 'exited', code: 1 } })
    expect(crashing.detail).toContain('restarted it 5 times')
    expect(crashing.detail).not.toContain('Reinstall')
  })

  it('shows no progress track while closing', () => {
    expect(describe({ phase: 'stopping' }).done).toBeUndefined()
  })
})
