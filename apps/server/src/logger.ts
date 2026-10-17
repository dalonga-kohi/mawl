import pino, { type DestinationStream, type Logger } from 'pino'
import type { LogLevel } from './config.ts'

export type { Logger }

/** Field paths whose values are replaced before a line is written. */
export const REDACT_PATHS = [
  'secret',
  '*.secret',
  'apiKey',
  '*.apiKey',
  'token',
  '*.token',
  'password',
  '*.password',
  'secretEnc',
  '*.secretEnc',
  'req.headers.authorization',
  'req.headers.cookie',
  'databaseUrl',
  '*.databaseUrl',
]

export interface LoggerOptions {
  level: LogLevel
  /** Defaults to stdout. Tests pass an in-memory stream. */
  stream?: DestinationStream
}

export function createLogger({ level, stream }: LoggerOptions): Logger {
  return pino({ level, redact: { paths: REDACT_PATHS, censor: '[Redacted]' } }, stream)
}
