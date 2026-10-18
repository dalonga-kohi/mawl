import type { RunErrorCode } from '@faire/contracts'
import { ProviderFailureError } from '../providers/failure.ts'

/** The profile's model ref does not parse, or its credential does not exist. */
export class ModelNotConfiguredError extends Error {
  constructor() {
    super('Model is not configured')
    this.name = 'ModelNotConfiguredError'
  }
}

/**
 * Maps anything thrown during a run to the closed set that may be stored. Exception text is
 * never used: provider and SDK errors can echo credentials.
 */
export function toRunErrorCode(err: unknown): RunErrorCode {
  if (err instanceof ProviderFailureError) return err.reason
  if (err instanceof ModelNotConfiguredError) return 'model_not_configured'
  return 'internal_error'
}
