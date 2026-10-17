import { afterEach, describe, expect, it, vi } from 'vitest'
import { dockerPolicy, isDockerAvailable, type PostgresHandle, withPostgres } from './postgres'

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

describe('isDockerAvailable default timeout', () => {
  it('gives up on a hanging probe after 30 seconds', async () => {
    vi.useFakeTimers()
    const result = isDockerAvailable(() => new Promise<never>(() => {}))
    let settled = false
    void result.then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(29_999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await result).toBe(false)
  })
})

describe('dockerPolicy', () => {
  it('runs when Docker is available, whatever the env', () => {
    expect(dockerPolicy(true, { CI: '1' })).toBe('run')
    expect(dockerPolicy(true, {})).toBe('run')
  })

  it('skips locally when Docker is unavailable', () => {
    expect(dockerPolicy(false, {})).toBe('skip')
  })

  it('fails instead of skipping when CI is set', () => {
    expect(dockerPolicy(false, { CI: 'true' })).toBe('fail')
  })

  it('fails instead of skipping when FAIRE_REQUIRE_DOCKER is set', () => {
    expect(dockerPolicy(false, { FAIRE_REQUIRE_DOCKER: '1' })).toBe('fail')
  })

  it('treats empty, 0 and false as not set', () => {
    for (const v of ['', '0', 'false']) {
      expect(dockerPolicy(false, { CI: v, FAIRE_REQUIRE_DOCKER: v })).toBe('skip')
    }
  })
})

const counters = { starts: 0, stops: 0, skippedBodyRan: false }
const fakeStart = async (): Promise<PostgresHandle> => {
  counters.starts++
  return {
    url: 'postgres://fake/db',
    stop: async () => {
      counters.stops++
    },
  }
}

describe('withPostgres with Docker available', () => {
  const url = withPostgres({ probe: async () => undefined, start: fakeStart, env: {} })

  it('exposes the url of the started database', () => {
    expect(url()).toBe('postgres://fake/db')
    expect(counters.starts).toBe(1)
  })

  it.fails('still stops the database when a test throws', () => {
    throw new Error('test failure')
  })
})

describe('withPostgres cleanup', () => {
  it('stopped the database after the previous suite, even though a test threw', () => {
    expect(counters.stops).toBe(1)
  })
})

describe('withPostgres without Docker (local)', () => {
  const url = withPostgres({
    probe: async () => {
      throw new Error('no docker')
    },
    start: fakeStart,
    env: {},
  })

  it('skips its tests instead of running them', () => {
    counters.skippedBodyRan = true
    expect(url).toBeTypeOf('function')
  })
})

describe('withPostgres skip result', () => {
  it('never ran the skipped body and never started a database', () => {
    expect(counters.skippedBodyRan).toBe(false)
    expect(counters.starts).toBe(1)
  })
})
