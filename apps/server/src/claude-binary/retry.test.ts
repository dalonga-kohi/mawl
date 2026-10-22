import { describe, expect, it, vi } from 'vitest'
import { retryTransient } from './retry.ts'

const busy = () => Object.assign(new Error('busy'), { code: 'EBUSY' })

describe('retryTransient', () => {
  it('retries EPERM, EBUSY and EACCES until the call succeeds', async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(busy())
      .mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'EPERM' }))
      .mockResolvedValue('ok')
    expect(await retryTransient(fn, { delaysMs: [0, 0, 0] })).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('gives up with the last error once the delays run out', async () => {
    const fn = vi.fn(async () => {
      throw busy()
    })
    await expect(retryTransient(fn, { delaysMs: [0, 0] })).rejects.toMatchObject({ code: 'EBUSY' })
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('does not retry other errors', async () => {
    const fn = vi.fn(async () => {
      throw Object.assign(new Error('gone'), { code: 'ENOENT' })
    })
    await expect(retryTransient(fn, { delaysMs: [0, 0] })).rejects.toMatchObject({ code: 'ENOENT' })
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
