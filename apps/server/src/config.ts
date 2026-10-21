import { isAbsolute } from 'node:path'
import { z } from 'zod'

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

/** Treat an empty string like an unset variable. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema)

function isPostgresUrl(value: string): boolean {
  if (!/^postgres(ql)?:\/\//.test(value)) return false
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

/** A path that does not depend on the server's working directory. */
const absolutePath = () =>
  z.string().min(1).refine(isAbsolute, { error: 'must be an absolute path' })

/** A TCP port from a string env value. */
const port = (defaultPort: number) =>
  optional(
    z
      .string()
      .regex(/^\d+$/, { error: 'must be an integer' })
      .transform(Number)
      .pipe(
        z
          .number()
          .int()
          .min(1, { error: 'must be 1-65535' })
          .max(65535, { error: 'must be 1-65535' }),
      )
      .default(defaultPort),
  )

/** A bare origin, scheme and host with an optional port: no path, query or wildcard. */
const BARE_ORIGIN = /^[a-z][a-z0-9+.-]*:\/\/[^/?#\s*]+$/i

/** Comma-separated origins, trimmed, trailing slashes dropped. The message never echoes the value. */
const originList = () =>
  z
    .string()
    .transform((v) =>
      v
        .split(',')
        .map((o) => o.trim().replace(/\/+$/, ''))
        .filter((o) => o !== ''),
    )
    .refine((list) => list.every((o) => BARE_ORIGIN.test(o)), {
      error: 'must be a comma-separated list of origins like https://host[:port]',
    })
    .default([])

const EnvSchema = z.object({
  DATABASE_URL: z.string({ error: 'is required' }).refine(isPostgresUrl, {
    error: 'must be a valid postgres:// or postgresql:// URL',
  }),
  MAWL_HOST: optional(z.string().min(1).default('127.0.0.1')),
  MAWL_PORT: port(7420),
  MAWL_SECRETS_DIR: optional(z.string().min(1).default('.mawl/secrets')),
  // Loopback port and bind address for the Sign in with ChatGPT callback. In Docker bind 0.0.0.0
  // inside the container and publish it on the host as 127.0.0.1:<port>:<port> only.
  MAWL_SIWC_PORT: port(1455),
  MAWL_SIWC_BIND_HOST: optional(z.string().min(1).default('127.0.0.1')),
  // Claude subscription via the Claude Code binary. The config dir holds the owner's own
  // `claude auth login` (Mawl never reads it); the path overrides the binary the SDK bundles.
  MAWL_CLAUDE_CONFIG_DIR: optional(absolutePath().optional()),
  MAWL_CLAUDE_CODE_PATH: optional(absolutePath().optional()),
  // Built web app to serve. Unset: `web` beside the bundle when it exists, else none (dev uses Vite).
  MAWL_WEB_DIR: optional(absolutePath().optional()),
  // Extra browser origins allowed to open the WebSocket (same-host, loopback and Tauri always are).
  MAWL_ALLOWED_ORIGINS: optional(originList()),
  LOG_LEVEL: optional(
    z.enum(LOG_LEVELS, { error: `must be one of ${LOG_LEVELS.join(', ')}` }).default('info'),
  ),
})

export interface Config {
  databaseUrl: string
  host: string
  port: number
  secretsDir: string
  siwcPort: number
  siwcHost: string
  claudeConfigDir?: string | undefined
  claudeCodePath?: string | undefined
  /** Directory of the built web app, when the owner set one. */
  webDir?: string | undefined
  /** Origins besides same-host, loopback and Tauri that may open the WebSocket. */
  allowedOrigins?: string[] | undefined
  logLevel: LogLevel
}

/** Lists bad variable names and rule messages only. Values (DATABASE_URL has a password) never appear. */
export class ConfigError extends Error {
  constructor(readonly issues: { name: string; message: string }[]) {
    super(`Invalid configuration:\n${issues.map((i) => `  ${i.name}: ${i.message}`).join('\n')}`)
    this.name = 'ConfigError'
  }
}

export function parseConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = EnvSchema.safeParse(env)
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((issue) => ({
        name: String(issue.path[0] ?? 'env'),
        message: issue.message,
      })),
    )
  }
  const v = parsed.data
  return {
    databaseUrl: v.DATABASE_URL,
    host: v.MAWL_HOST,
    port: v.MAWL_PORT,
    secretsDir: v.MAWL_SECRETS_DIR,
    siwcPort: v.MAWL_SIWC_PORT,
    siwcHost: v.MAWL_SIWC_BIND_HOST,
    claudeConfigDir: v.MAWL_CLAUDE_CONFIG_DIR,
    claudeCodePath: v.MAWL_CLAUDE_CODE_PATH,
    webDir: v.MAWL_WEB_DIR,
    allowedOrigins: v.MAWL_ALLOWED_ORIGINS,
    logLevel: v.LOG_LEVEL,
  }
}
