import { isAbsolute, join } from 'node:path'
import { z } from 'zod'

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

/** `headless`: Docker or a plain process with its own Postgres. `desktop`: spawned by the Tauri host. */
export const MODES = ['desktop', 'headless'] as const
export type Mode = (typeof MODES)[number]

/** Under MAWL_DATA_DIR in desktop mode (ARCHITECTURE: `{pg-data,secrets,claude,logs,artifacts}`). */
export const DESKTOP_PG_DATA_DIR = 'pg-data'
export const DESKTOP_SECRETS_DIR = 'secrets'
/** The only bind addresses desktop mode accepts. */
export const DESKTOP_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', '::1', 'localhost'])

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
  MAWL_MODE: optional(
    z.enum(MODES, { error: `must be one of ${MODES.join(', ')}` }).default('headless'),
  ),
  // Required in headless mode, optional in desktop mode (checked in ModeSchema below).
  DATABASE_URL: optional(
    z
      .string()
      .refine(isPostgresUrl, { error: 'must be a valid postgres:// or postgresql:// URL' })
      .optional(),
  ),
  MAWL_HOST: optional(z.string().min(1).default('127.0.0.1')),
  MAWL_PORT: port(7420),
  // Default depends on the mode: `.mawl/secrets` headless, `<MAWL_DATA_DIR>/secrets` desktop.
  MAWL_SECRETS_DIR: optional(z.string().min(1).optional()),
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

const issue = (name: string, message: string) => ({
  code: 'custom' as const,
  path: [name],
  message,
})

/**
 * Rules that depend on the mode. A separate schema whose fields never fail on their own, so its
 * check always runs and its issues are listed together with EnvSchema's. In headless mode the
 * desktop variables are ignored (a developer shell may have MAWL_PG_ROOT set for the D1.1 suite).
 */
const ModeSchema = z
  .object({
    MAWL_MODE: z.unknown().optional(),
    DATABASE_URL: z.unknown().optional(),
    MAWL_DATA_DIR: z.unknown().optional(),
    MAWL_PG_ROOT: z.unknown().optional(),
    MAWL_SECRETS_DIR: z.unknown().optional(),
    MAWL_HOST: z.unknown().optional(),
  })
  .superRefine((env, ctx) => {
    const set = (v: unknown): v is string => typeof v === 'string' && v !== ''
    const absolute = (name: string, v: unknown) => {
      if (!set(v)) ctx.addIssue(issue(name, 'is required in desktop mode'))
      else if (!isAbsolute(v)) ctx.addIssue(issue(name, 'must be an absolute path'))
    }
    const mode = set(env.MAWL_MODE) ? env.MAWL_MODE : 'headless'
    if (mode === 'headless') {
      if (!set(env.DATABASE_URL)) ctx.addIssue(issue('DATABASE_URL', 'is required'))
      return
    }
    if (mode !== 'desktop') return // EnvSchema reports the bad MAWL_MODE.
    absolute('MAWL_DATA_DIR', env.MAWL_DATA_DIR)
    // A relative dir would follow the host's working directory, which may be the install dir.
    if (set(env.MAWL_SECRETS_DIR)) absolute('MAWL_SECRETS_DIR', env.MAWL_SECRETS_DIR)
    // The desktop server is reachable from this machine only (no device auth until D8.1).
    if (set(env.MAWL_HOST) && !DESKTOP_HOSTS.has(env.MAWL_HOST)) {
      ctx.addIssue(
        issue('MAWL_HOST', `must be one of ${[...DESKTOP_HOSTS].join(', ')} in desktop mode`),
      )
    }
    // Without a database url the server runs the embedded Postgres from the install's `pg\`.
    if (!set(env.DATABASE_URL)) absolute('MAWL_PG_ROOT', env.MAWL_PG_ROOT)
  })

/** The bundled Postgres the desktop server starts (D1.1), when no DATABASE_URL is given. */
export interface EmbeddedPgConfig {
  /** The install's `pg\` (binaries). */
  pgRoot: string
  /** `<MAWL_DATA_DIR>/pg-data`: the cluster and its password. */
  dataRoot: string
}

export interface Config {
  /** Defaults to headless when absent (tests and older callers build configs by hand). */
  mode?: Mode
  /** Set in headless mode, and in desktop mode when the owner points at their own Postgres. */
  databaseUrl?: string | undefined
  /** Set exactly when desktop mode has no databaseUrl. */
  embeddedPg?: EmbeddedPgConfig | undefined
  /** Desktop only: Tauri's app_local_data_dir, never the install dir. */
  dataDir?: string | undefined
  /**
   * Desktop only: the per-launch token, read from stdin's first line by main (never env or argv).
   * Memory only, never logged. D1.4 enforces it on /rpc and /ws.
   */
  launchToken?: string | undefined
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
  const mode = ModeSchema.safeParse(env)
  const issues = [
    ...(parsed.success ? [] : parsed.error.issues),
    ...(mode.success ? [] : mode.error.issues),
  ]
  if (!parsed.success || issues.length > 0) {
    throw new ConfigError(
      issues.map((issue) => ({
        name: String(issue.path[0] ?? 'env'),
        message: issue.message,
      })),
    )
  }
  const v = parsed.data
  // ModeSchema guarantees MAWL_DATA_DIR in desktop mode and MAWL_PG_ROOT when there is no url.
  const desktop = v.MAWL_MODE === 'desktop'
  const dataDir = desktop ? (env.MAWL_DATA_DIR as string) : undefined
  return {
    mode: v.MAWL_MODE,
    databaseUrl: v.DATABASE_URL,
    embeddedPg:
      dataDir && !v.DATABASE_URL
        ? { pgRoot: env.MAWL_PG_ROOT as string, dataRoot: join(dataDir, DESKTOP_PG_DATA_DIR) }
        : undefined,
    dataDir,
    host: v.MAWL_HOST,
    port: v.MAWL_PORT,
    secretsDir:
      v.MAWL_SECRETS_DIR ?? (dataDir ? join(dataDir, DESKTOP_SECRETS_DIR) : '.mawl/secrets'),
    siwcPort: v.MAWL_SIWC_PORT,
    siwcHost: v.MAWL_SIWC_BIND_HOST,
    claudeConfigDir: v.MAWL_CLAUDE_CONFIG_DIR,
    claudeCodePath: v.MAWL_CLAUDE_CODE_PATH,
    webDir: v.MAWL_WEB_DIR,
    allowedOrigins: v.MAWL_ALLOWED_ORIGINS,
    logLevel: v.LOG_LEVEL,
  }
}
