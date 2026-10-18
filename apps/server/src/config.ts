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

const EnvSchema = z.object({
  DATABASE_URL: z.string({ error: 'is required' }).refine(isPostgresUrl, {
    error: 'must be a valid postgres:// or postgresql:// URL',
  }),
  FAIRE_HOST: optional(z.string().min(1).default('127.0.0.1')),
  FAIRE_PORT: port(7420),
  FAIRE_SECRETS_DIR: optional(z.string().min(1).default('.faire/secrets')),
  // Loopback port and bind address for the Sign in with ChatGPT callback. In Docker bind 0.0.0.0
  // inside the container and publish it on the host as 127.0.0.1:<port>:<port> only.
  FAIRE_SIWC_PORT: port(1455),
  FAIRE_SIWC_BIND_HOST: optional(z.string().min(1).default('127.0.0.1')),
  // Claude subscription via the Claude Code binary. The config dir holds the owner's own
  // `claude auth login` (Faire never reads it); the path overrides the binary the SDK bundles.
  FAIRE_CLAUDE_CONFIG_DIR: optional(z.string().min(1).optional()),
  FAIRE_CLAUDE_CODE_PATH: optional(z.string().min(1).optional()),
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
    host: v.FAIRE_HOST,
    port: v.FAIRE_PORT,
    secretsDir: v.FAIRE_SECRETS_DIR,
    siwcPort: v.FAIRE_SIWC_PORT,
    siwcHost: v.FAIRE_SIWC_BIND_HOST,
    claudeConfigDir: v.FAIRE_CLAUDE_CONFIG_DIR,
    claudeCodePath: v.FAIRE_CLAUDE_CODE_PATH,
    logLevel: v.LOG_LEVEL,
  }
}
