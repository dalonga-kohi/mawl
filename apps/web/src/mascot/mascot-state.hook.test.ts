import type { RunStatus } from '@mawl/contracts'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { END_POSE_MS, useMascotState } from './mascot-state.ts'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function setup(initial: RunStatus | undefined) {
  return renderHook(({ run }: { run: RunStatus | undefined }) => useMascotState({ run }), {
    initialProps: { run: initial },
  })
}

describe('useMascotState end pose', () => {
  it('plays done after a watched run succeeds, then settles to idle', () => {
    const { result, rerender } = setup('running')
    expect(result.current).toBe('thinking')
    rerender({ run: 'succeeded' })
    expect(result.current).toBe('done')
    act(() => void vi.advanceTimersByTime(END_POSE_MS - 1))
    expect(result.current).toBe('done')
    act(() => void vi.advanceTimersByTime(1))
    expect(result.current).toBe('idle')
  })

  it('plays error after a watched run fails', () => {
    const { result, rerender } = setup('queued')
    rerender({ run: 'failed' })
    expect(result.current).toBe('error')
  })

  it('stays idle for a run that was already over when the view opened', () => {
    const { result } = setup('succeeded')
    expect(result.current).toBe('idle')
    const failed = setup('failed')
    expect(failed.result.current).toBe('idle')
  })

  it('stays idle when the run data first arrives already finished', () => {
    const { result, rerender } = setup(undefined)
    rerender({ run: 'succeeded' })
    expect(result.current).toBe('idle')
  })

  it('does not celebrate a stopped run', () => {
    const { result, rerender } = setup('running')
    rerender({ run: 'cancelled' })
    expect(result.current).toBe('idle')
  })

  it('does not replay the pose when the same finished status repeats', () => {
    const { result, rerender } = setup('running')
    rerender({ run: 'succeeded' })
    act(() => void vi.advanceTimersByTime(END_POSE_MS))
    expect(result.current).toBe('idle')
    rerender({ run: 'succeeded' })
    expect(result.current).toBe('idle')
  })
})
