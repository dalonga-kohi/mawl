import type { Logger } from '../logger.ts'
import type { ProvidersDb } from '../providers/types.ts'
import { createEventBus, type EventBus, type EventBusOptions } from './bus.ts'
import { createDeltaCoalescer, type DeltaCoalescer } from './deltas.ts'
import type { NotificationSource } from './source.ts'

export interface LiveEventsOptions {
  db: ProvidersDb
  source: NotificationSource
  logger: Logger
  /** Replaces the bus factory, so tests can observe the wiring. */
  makeBus?: (options: EventBusOptions) => EventBus
}

export interface LiveEvents {
  bus: EventBus
  deltas: DeltaCoalescer
  start(): Promise<void>
  /** Sends the text still waiting, then stops the bus: the order matters, the bus must still be able to carry it. */
  stop(): Promise<void>
}

/** The event bus plus the delta coalescer that feeds it, wired so text never overtakes a stored event. */
export function createLiveEvents(options: LiveEventsOptions): LiveEvents {
  let deltas: DeltaCoalescer | undefined
  const bus = (options.makeBus ?? createEventBus)({
    db: options.db,
    source: options.source,
    logger: options.logger,
    // A stored event of a run must not overtake the text that precedes it.
    beforePersisted: (event) => {
      if (event.runId) deltas?.flush(event.runId)
    },
  })
  const coalescer = createDeltaCoalescer({
    publish: ({ profileId, runId, stepIdx, text }) =>
      bus.publishEphemeral({ profileId, runId, type: 'run.delta', payload: { text, stepIdx } }),
  })
  deltas = coalescer
  return {
    bus,
    deltas: coalescer,
    start: () => bus.start(),
    async stop() {
      coalescer.close()
      await bus.stop()
    },
  }
}
