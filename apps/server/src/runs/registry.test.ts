import { newId } from '@faire/contracts'
import { describe, expect, it } from 'vitest'
import { RunRegistry } from './registry.ts'

describe('RunRegistry', () => {
  it('hands out one controller per run and refuses a second while it is registered', () => {
    const registry = new RunRegistry()
    const id = newId('run')
    const first = registry.register(id)
    expect(first).not.toBeNull()
    expect(registry.register(id)).toBeNull()
    registry.release(id, first as AbortController)
    expect(registry.register(id)).not.toBeNull()
  })

  it('aborts a registered run with the given reason and reports whether it was running', () => {
    const registry = new RunRegistry()
    const id = newId('run')
    const controller = registry.register(id) as AbortController
    expect(registry.abort(id, 'cancel')).toBe(true)
    expect(controller.signal.aborted).toBe(true)
    expect(controller.signal.reason).toBe('cancel')
    expect(registry.abort(newId('run'), 'cancel')).toBe(false)
  })

  it('aborts every run on shutdown', () => {
    const registry = new RunRegistry()
    const a = registry.register(newId('run')) as AbortController
    const b = registry.register(newId('run')) as AbortController
    registry.abortAll('shutdown')
    expect([a.signal.reason, b.signal.reason]).toEqual(['shutdown', 'shutdown'])
    expect(registry.size).toBe(2)
  })

  it('does not release a newer controller for the same run', () => {
    const registry = new RunRegistry()
    const id = newId('run')
    const old = registry.register(id) as AbortController
    registry.release(id, old)
    const fresh = registry.register(id) as AbortController
    registry.release(id, old)
    expect(registry.register(id)).toBeNull()
    registry.release(id, fresh)
    expect(registry.size).toBe(0)
  })
})
