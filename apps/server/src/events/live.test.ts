import { type LenientEnvelope, newId } from '@faire/contracts'
import { describe, expect, it, vi } from 'vitest'
import { createLogger } from '../logger.ts'
import type { ProvidersDb } from '../providers/types.ts'
import type { EphemeralEvent, EventBus, EventBusOptions } from './bus.ts'
import { createLiveEvents } from './live.ts'
import type { NotificationSource } from './source.ts'

const profileId = newId('profile')
const runX = newId('run')
const runY = newId('run')

function setup() {
  const log: string[] = []
  const published: EphemeralEvent[] = []
  let busOptions!: EventBusOptions
  const bus = {
    async start() {
      log.push('bus.start')
    },
    async stop() {
      log.push('bus.stop')
    },
    publishEphemeral(event: EphemeralEvent) {
      log.push(`publish:${event.runId}`)
      published.push(event)
    },
  } as unknown as EventBus
  const live = createLiveEvents({
    db: {} as ProvidersDb,
    source: {} as NotificationSource,
    logger: createLogger({ level: 'silent' }),
    makeBus: (options) => {
      busOptions = options
      return bus
    },
  })
  const stored = (runId: typeof runX): LenientEnvelope => ({
    v: 1,
    id: '1',
    type: 'run.step',
    profileId,
    runId,
    ts: '2026-01-01T00:00:00.000Z',
    payload: {},
  })
  return { live, log, published, stored, beforePersisted: () => busOptions.beforePersisted }
}

describe('live events wiring', () => {
  it("flushes a run's pending text before a stored event of that run reaches listeners", async () => {
    vi.useFakeTimers()
    try {
      const { live, published, stored, beforePersisted } = setup()
      live.deltas.add({ profileId, runId: runX, stepIdx: 0, text: 'abc' })
      live.deltas.add({ profileId, runId: runY, stepIdx: 0, text: 'other' })
      expect(published).toHaveLength(0)
      beforePersisted()?.(stored(runX))
      expect(published.map((p) => [p.runId, p.payload])).toEqual([
        [runX, { text: 'abc', stepIdx: 0 }],
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores stored events that belong to no run', () => {
    const { live, published, stored, beforePersisted } = setup()
    live.deltas.add({ profileId, runId: runX, stepIdx: 0, text: 'abc' })
    const { runId: _omit, ...noRun } = stored(runX)
    beforePersisted()?.(noRun)
    expect(published).toHaveLength(0)
    live.deltas.close()
  })

  it('on stop sends the last pending text first, then stops the bus', async () => {
    vi.useFakeTimers()
    try {
      const { live, log } = setup()
      await live.start()
      live.deltas.add({ profileId, runId: runX, stepIdx: 0, text: 'tail' })
      await live.stop()
      expect(log).toEqual(['bus.start', `publish:${runX}`, 'bus.stop'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops the bus even when nothing was pending', async () => {
    const { live, log } = setup()
    await live.stop()
    expect(log).toEqual(['bus.stop'])
  })
})
