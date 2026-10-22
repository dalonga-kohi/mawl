import { describe, expect, it, vi } from 'vitest'
import { runTeardown } from './teardown.ts'

describe('runTeardown', () => {
  it('runs every step in order', async () => {
    const order: number[] = []
    await runTeardown([() => void order.push(1), async () => void order.push(2)])
    expect(order).toEqual([1, 2])
  })

  it('keeps going after a step throws or rejects, then rethrows that error', async () => {
    const last = vi.fn()
    const boom = new Error('boom')
    await expect(
      runTeardown([
        () => {
          throw boom
        },
        last,
      ]),
    ).rejects.toBe(boom)
    expect(last).toHaveBeenCalledTimes(1)
  })

  it('reports several failures together', async () => {
    const last = vi.fn()
    const err = await runTeardown([
      async () => {
        throw new Error('a')
      },
      async () => {
        throw new Error('b')
      },
      last,
    ]).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AggregateError)
    expect((err as AggregateError).errors).toHaveLength(2)
    expect(last).toHaveBeenCalledTimes(1)
  })
})
