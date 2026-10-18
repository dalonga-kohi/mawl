import type { CredentialId } from '@faire/contracts'
import type { schema } from '@faire/db'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

/** Works with node-postgres in production and PGlite in tests. */
export type ProvidersDb = PgDatabase<PgQueryResultHKT, typeof schema>

export class CredentialNotFoundError extends Error {
  constructor(readonly id: CredentialId) {
    super('Provider credential not found')
    this.name = 'CredentialNotFoundError'
  }
}

/** A stored key exists but cannot be decrypted (typically the master key changed). */
export class CredentialUnreadableError extends Error {
  constructor(readonly id: CredentialId) {
    super('Provider credential could not be decrypted')
    this.name = 'CredentialUnreadableError'
  }
}

/** A sign-in attempt id the server does not know (never started, or forgotten). */
export class SignInAttemptNotFoundError extends Error {
  constructor(readonly id: string) {
    super('Sign-in attempt not found')
    this.name = 'SignInAttemptNotFoundError'
  }
}

/** Sign in with ChatGPT cannot start: no host id, or the loopback port cannot be bound. */
export class SignInUnavailableError extends Error {
  constructor(readonly why: 'not_configured' | 'listener_failed') {
    super(`Sign in with ChatGPT is unavailable: ${why}`)
    this.name = 'SignInUnavailableError'
  }
}
