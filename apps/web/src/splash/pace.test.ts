import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { beatDelay, MIN_BEAT_MS, nextBeat, usePacedStatus } from './pace.ts'
import type { Status } from './status.ts'

const DB: Status = { phase: 'starting', stage: 'database' }
const SERVER: Status = { phase: 'starting', stage: 'server' }
const READY: Status = { phase: 'ready' }
const FAILED: Status = { phase: 'failed', reason: { kind: 'boot_timeout' } }
const RESTARTING: Status = {
  phase: 'restarting',
  attempt: 2,
  reason: { kind: 'exited', code: 1 },
  retry_in_ms: 1000,
}

describe('the beat rules', () => {
  it('walks a skipped step instead of jumping over it', () => {
    expect(nextBeat(DB, READY)).toEqual(SERVER)
    expect(nextBeat(SERVER, READY)).toEqual(READY)
    expect(nextBeat(DB, SERVER)).toEqual(SERVER)
  })

  it('goes straight to anything that is not forward progress', () => {
    expect(nextBeat(DB, FAILED)).toEqual(FAILED)
    expect(nextBeat(READY, RESTARTING)).toEqual(RESTARTING)
    expect(nextBeat(RESTARTING, DB)).toEqual(DB)
    expect(nextBeat(READY, DB)).toEqual(DB)
  })

  it('holds forward progress until the current beat had its time, and nothing else', () => {
    expect(beatDelay(DB, SERVER, 0)).toBe(MIN_BEAT_MS)
    expect(beatDelay(DB, SERVER, 250)).toBe(MIN_BEAT_MS - 250)
    expect(beatDelay(DB, SERVER, MIN_BEAT_MS + 50)).toBe(0)
    expect(beatDelay(SERVER, FAILED, 0)).toBe(0)
    expect(beatDelay(READY, RESTARTING, 0)).toBe(0)
    expect(beatDelay(SERVER, DB, 0)).toBe(0)
  })

  it('keeps each beat near 600 ms, so a fast boot never flashes', () => {
    expect(MIN_BEAT_MS).toBeGreaterThanOrEqual(500)
    expect(MIN_BEAT_MS).toBeLessThanOrEqual(700)
  })
})

describe('usePacedStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows nothing until the host said something', () => {
    const { result } = renderHook(({ s }) => usePacedStatus(s), {
      initialProps: { s: undefined as Status | undefined },
    })
    expect(result.current).toBeUndefined()
  })

  it('adopts the first status without waiting, even when it is late progress', () => {
    const { result, rerender } = renderHook(({ s }) => usePacedStatus(s), {
      initialProps: { s: undefined as Status | undefined },
    })
    rerender({ s: READY })
    expect(result.current).toEqual(READY)
  })

  it('lights each step for a beat on a boot that is faster than the eye', () => {
    const { result, rerender } = renderHook(({ s }) => usePacedStatus(s), {
      initialProps: { s: DB as Status | undefined },
    })
    expect(result.current).toEqual(DB)
    rerender({ s: READY })
    expect(result.current).toEqual(DB)
    act(() => vi.advanceTimersByTime(MIN_BEAT_MS - 1))
    expect(result.current).toEqual(DB)
    act(() => vi.advanceTimersByTime(1))
    expect(result.current).toEqual(SERVER)
    act(() => vi.advanceTimersByTime(MIN_BEAT_MS - 1))
    expect(result.current).toEqual(SERVER)
    act(() => vi.advanceTimersByTime(1))
    expect(result.current).toEqual(READY)
  })

  it('shows a failure at once, even in the middle of a held beat', () => {
    const { result, rerender } = renderHook(({ s }) => usePacedStatus(s), {
      initialProps: { s: DB as Status | undefined },
    })
    rerender({ s: SERVER })
    act(() => vi.advanceTimersByTime(100))
    rerender({ s: FAILED })
    expect(result.current).toEqual(FAILED)
    // The pending server beat never lands on top of the failure.
    act(() => vi.advanceTimersByTime(MIN_BEAT_MS * 2))
    expect(result.current).toEqual(FAILED)
  })

  it('does not hold a step that already had its beat', () => {
    const { result, rerender } = renderHook(({ s }) => usePacedStatus(s), {
      initialProps: { s: DB as Status | undefined },
    })
    act(() => vi.advanceTimersByTime(MIN_BEAT_MS + 10))
    rerender({ s: SERVER })
    expect(result.current).toEqual(SERVER)
  })

  it('ignores a new object for the same status', () => {
    const { result, rerender } = renderHook(({ s }) => usePacedStatus(s), {
      initialProps: { s: { ...DB } as Status | undefined },
    })
    const first = result.current
    rerender({ s: { ...DB } })
    expect(result.current).toBe(first)
  })
})
