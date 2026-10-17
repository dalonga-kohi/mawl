import type { ProviderFailureReason } from '@faire/contracts'

/**
 * A provider call failed in a way the run engine and the app can name. It carries the closed
 * reason only (plus an optional wait in seconds), never provider text: that can echo credentials.
 */
export class ProviderFailureError extends Error {
  readonly reason: ProviderFailureReason
  /** Seconds to wait before retrying, when the provider said so. */
  readonly retryAfter: number | undefined

  constructor(reason: ProviderFailureReason, options: { retryAfter?: number } = {}) {
    super(`Provider failure: ${reason}`)
    this.name = 'ProviderFailureError'
    this.reason = reason
    this.retryAfter = options.retryAfter
  }
}
