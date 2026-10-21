import { newId } from '@mawl/contracts'
import { describe, expect, it } from 'vitest'
import { createDeltaCoalescer } from './deltas.ts'
import { fakeTimers } from './test-util.ts'

const profileId = newId('profile')
const runA = newId('run')
const runB = newId('run')

function setup() {
  const timers = fakeTimers()
  const out: { runId: string; stepIdx: number; text: string }[] = []
  const coalescer = createDeltaCoalescer({
    timers,
    publish: ({ runId, stepIdx, text }) => void out.push({ runId, stepIdx, text }),
  })
  const add = (runId = runA, text = 'x', stepIdx = 0) =>
    coalescer.add({ profileId, runId, stepIdx, text })
  return { timers, out, coalescer, add }
}

describe('delta coalescer', () => {
  it('joins tokens that arrive within 50 ms into one delta', () => {
    const { timers, out, add } = setup()
    add(runA, 'Hel')
    timers.advance(20)
    add(runA, 'lo ')
    timers.advance(20)
    add(runA, 'world')
    expect(out).toEqual([])
    timers.advance(10)
    expect(out).toEqual([{ runId: runA, stepIdx: 0, text: 'Hello world' }])
  })

  it('starts a new window after a flush', () => {
    const { timers, out, add } = setup()
    add(runA, 'a')
    timers.advance(50)
    add(runA, 'b')
    timers.advance(49)
    expect(out.map((d) => d.text)).toEqual(['a'])
    timers.advance(1)
    expect(out.map((d) => d.text)).toEqual(['a', 'b'])
  })

  it('keeps runs apart', () => {
    const { timers, out, add } = setup()
    add(runA, 'a')
    add(runB, 'b')
    timers.advance(50)
    expect(out.map((d) => [d.runId, d.text]).sort()).toEqual(
      [
        [runA, 'a'],
        [runB, 'b'],
      ].sort(),
    )
  })

  it('flush(run) sends that run now and leaves others waiting', () => {
    const { timers, out, coalescer, add } = setup()
    add(runA, 'a')
    add(runB, 'b')
    coalescer.flush(runA)
    expect(out).toEqual([{ runId: runA, stepIdx: 0, text: 'a' }])
    timers.advance(50)
    expect(out.map((d) => d.text)).toEqual(['a', 'b'])
  })

  it('flush of a quiet run sends nothing and a flushed run does not send again on its timer', () => {
    const { timers, out, coalescer, add } = setup()
    coalescer.flush(runA)
    add(runA, 'a')
    coalescer.flush(runA)
    timers.advance(100)
    expect(out).toHaveLength(1)
  })

  it('sends buffered text of an earlier step before the first token of the next step', () => {
    const { timers, out, add } = setup()
    add(runA, 'one', 0)
    add(runA, 'two', 1)
    timers.advance(50)
    expect(out).toEqual([
      { runId: runA, stepIdx: 0, text: 'one' },
      { runId: runA, stepIdx: 1, text: 'two' },
    ])
  })

  it('flushAll sends everything and close cancels timers', () => {
    const { timers, out, coalescer, add } = setup()
    add(runA, 'a')
    add(runB, 'b')
    coalescer.close()
    expect(out).toHaveLength(2)
    expect(timers.pending).toHaveLength(0)
    add(runA, 'late')
    expect(timers.pending).toHaveLength(0)
    expect(out).toHaveLength(2)
  })
})
