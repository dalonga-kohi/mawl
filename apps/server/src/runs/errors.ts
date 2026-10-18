import type { RunStatus } from '@faire/contracts'

export type EntityKind = 'profile' | 'thread' | 'run' | 'message'

export class EntityNotFoundError extends Error {
  constructor(
    readonly entity: EntityKind,
    readonly id: string,
  ) {
    super(`${entity} not found`)
    this.name = 'EntityNotFoundError'
  }
}

/** The run is not in a state that allows the requested change. */
export class RunConflictError extends Error {
  constructor(
    readonly from: RunStatus,
    readonly to: RunStatus,
  ) {
    super(`Run cannot go from ${from} to ${to}`)
    this.name = 'RunConflictError'
  }
}
