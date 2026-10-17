import pino, { type DestinationStream, type Logger } from 'pino'
import type { LogLevel } from './config.ts'
import { redactDeep } from './redact.ts'

export type { Logger }

/** Header paths pino censors itself; every other key is handled by redactDeep. */
export const REDACT_PATHS = ['req.headers.authorization', 'req.headers.cookie']

export interface LoggerOptions {
  level: LogLevel
  /** Defaults to stdout. Tests pass an in-memory stream. */
  stream?: DestinationStream
}

export function createLogger({ level, stream }: LoggerOptions): Logger {
  return pino(
    {
      level,
      redact: { paths: REDACT_PATHS, censor: '[Redacted]' },
      // Recursive, key-based: covers arrays and any depth (pino paths are fixed-depth).
      formatters: { log: (object) => redactDeep(object) as Record<string, unknown> },
    },
    stream,
  )
}
