import { describe, expect, it } from 'vitest'
import { executeRun } from './execute.ts'
import { setup } from './test-util.ts'

describe('executeRun: onStepEnd', () => {
  it('reports the step after its last text delta, once per model step', async () => {
    const order: string[] = []
    const { deps, runId } = setup([{ text: 'Hello there' }], {
      onDelta: () => void order.push('delta'),
      onStepEnd: ({ runId: id, stepIdx }) => void order.push(`end:${id === runId}:${stepIdx}`),
    })
    await executeRun(deps)
    expect(order.at(-1)).toBe('end:true:0')
    expect(order.filter((o) => o.startsWith('end'))).toHaveLength(1)
    expect(order.indexOf('end:true:0')).toBeGreaterThan(order.lastIndexOf('delta'))
  })

  it('reports the step when the model stream fails', async () => {
    const ends: number[] = []
    const { deps } = setup([{ error: new Error('boom') }], {
      onStepEnd: ({ stepIdx }) => void ends.push(stepIdx),
    })
    await executeRun(deps)
    expect(ends).toEqual([0])
  })
})
