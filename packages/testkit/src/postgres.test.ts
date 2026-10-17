import { afterEach, describe, expect, it, vi } from 'vitest'
import { isDockerAvailable } from './postgres'

afterEach(() => {
  vi.useRealTimers()
})

describe('isDockerAvailable', () => {
  it('is true when the probe resolves', async () => {
    expect(await isDockerAvailable(async () => undefined)).toBe(true)
  })

  it('is false, without throwing, when the probe rejects', async () => {
    const probe = async () => {
      throw new Error('no docker')
    }
    expect(await isDockerAvailable(probe)).toBe(false)
  })

  it('is false when the probe throws synchronously', async () => {
    const probe = (): Promise<unknown> => {
      throw new Error('boom')
    }
    expect(await isDockerAvailable(probe)).toBe(false)
  })

  it('is false when the probe hangs past the timeout', async () => {
    vi.useFakeTimers()
    const hanging = new Promise<never>(() => {})
    const result = isDockerAvailable(() => hanging, 3000)
    await vi.advanceTimersByTimeAsync(2999)
    let settled = false
    void result.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await result).toBe(false)
  })

  it('leaves no pending timer behind when the probe is fast', async () => {
    vi.useFakeTimers()
    await isDockerAvailable(async () => undefined, 3000)
    expect(vi.getTimerCount()).toBe(0)
  })
})
