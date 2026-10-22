import { ConfigError } from './config.ts'
import { EmbeddedPgError } from './embedded-pg/index.ts'
import { LaunchTokenError } from './launch-token.ts'
import { MasterKeyError, SecretDecryptError } from './secrets/index.ts'

export interface FailureInfo {
  errName: string
  code?: string
  reason?: string
}

/** Classes whose messages we wrote and know hold no secrets (names, paths, sizes only). */
const OWN_ERRORS = [ConfigError, MasterKeyError, SecretDecryptError, LaunchTokenError]

/**
 * Classes with a closed set of lower-case codes, which are kept. EmbeddedPgError's message wraps
 * foreign error text, so only its code is logged; the desktop host maps the code to its own copy.
 */
const TYPED_CODE_ERRORS = [EmbeddedPgError, LaunchTokenError]

/**
 * What may be logged about a failure we did not expect. Foreign errors (pg, node, libraries)
 * can embed connection strings or inputs in their message or extra fields, so only the class
 * name and a short upper-case code are kept. The message is kept for our own error classes.
 */
export function describeFailure(err: unknown): FailureInfo {
  if (!(err instanceof Error)) return { errName: 'UnknownError' }
  const info: FailureInfo = { errName: err.name }
  const code = (err as { code?: unknown }).code
  if (typeof code === 'string' && /^[A-Z0-9_]{1,40}$/.test(code)) info.code = code
  if (typeof code === 'string' && TYPED_CODE_ERRORS.some((cls) => err instanceof cls)) {
    info.code = code
  }
  if (OWN_ERRORS.some((cls) => err instanceof cls)) info.reason = err.message
  return info
}
