import { contract } from '@faire/contracts'
import { implement, ORPCError } from '@orpc/server'

export interface RouterDeps {
  version: string
}

/**
 * Not-yet-built procedures answer 501. The contract's typed error maps only describe
 * domain errors, but oRPC lets a handler throw any ORPCError; it reaches the client as a
 * plain ORPCError with this code and status.
 */
const notImplemented = (): never => {
  throw new ORPCError('NOT_IMPLEMENTED', { status: 501 })
}

/** Turns a contract procedure into a stub handler. */
const stub = <T>(procedure: { handler: (handler: () => never) => T }): T =>
  procedure.handler(notImplemented)

/**
 * Every procedure in the contract must appear here: this object is type-checked against the
 * contract, so adding a procedure to `@faire/contracts` fails the build until it is stubbed
 * or implemented. Replace a stub by a real handler when its slice lands.
 */
export function createRouter({ version }: RouterDeps) {
  const os = implement(contract)
  return os.router({
    health: { get: os.health.get.handler(() => ({ ok: true as const, version })) },
    profiles: {
      list: stub(os.profiles.list),
      get: stub(os.profiles.get),
      create: stub(os.profiles.create),
      update: stub(os.profiles.update),
      archive: stub(os.profiles.archive),
    },
    threads: {
      list: stub(os.threads.list),
      messages: stub(os.threads.messages),
    },
    runs: {
      start: stub(os.runs.start),
      get: stub(os.runs.get),
      cancel: stub(os.runs.cancel),
      pause: stub(os.runs.pause),
      resume: stub(os.runs.resume),
    },
    approvals: {
      list: stub(os.approvals.list),
      decide: stub(os.approvals.decide),
    },
    devices: {
      pair: stub(os.devices.pair),
      list: stub(os.devices.list),
      revoke: stub(os.devices.revoke),
    },
    settings: {
      get: stub(os.settings.get),
      update: stub(os.settings.update),
    },
    // WebSocket transport arrives in P1.5.
    events: { subscribe: stub(os.events.subscribe) },
  })
}

export type AppRouter = ReturnType<typeof createRouter>
