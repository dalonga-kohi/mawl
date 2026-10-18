import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import type { ProviderTestResult } from '@faire/contracts'
import { z } from 'zod'
import { buildClaudeEnv } from './env.ts'

const PACKAGE_PREFIX = '@anthropic-ai/claude-agent-sdk'

/** The platform packages the SDK ships its native binary in, most likely first. */
function candidates(platform: string, arch: string, isMusl: boolean): string[] {
  const file = platform === 'win32' ? 'claude.exe' : 'claude'
  const names =
    platform === 'linux'
      ? isMusl
        ? [`linux-${arch}-musl`, `linux-${arch}`]
        : [`linux-${arch}`, `linux-${arch}-musl`]
      : [`${platform}-${arch}`]
  return names.map((name) => `${PACKAGE_PREFIX}-${name}/${file}`)
}

function detectMusl(): boolean {
  if (process.platform !== 'linux') return false
  const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } }
  return report?.header?.glibcVersionRuntime === undefined
}

export interface ResolveBinaryOptions {
  platform?: string
  arch?: string
  isMusl?: boolean
  /** Resolves a module specifier to a file path, from the SDK's own location. */
  resolve?: (specifier: string) => string
}

/**
 * Finds the native Claude Code binary the SDK bundles, the same way the SDK does: the optional
 * per-platform package installed beside it. Null when none is installed.
 */
export function resolveBundledClaudeBinary({
  platform = process.platform,
  arch = process.arch,
  isMusl = detectMusl(),
  resolve = defaultResolve,
}: ResolveBinaryOptions = {}): string | null {
  for (const specifier of candidates(platform, arch, isMusl)) {
    try {
      return resolve(specifier)
    } catch {
      // Not installed for this platform; try the next one.
    }
  }
  return null
}

/** Platform packages are optional dependencies of the SDK, so they resolve from the SDK's path. */
function defaultResolve(specifier: string): string {
  const sdkEntry = createRequire(import.meta.url).resolve(PACKAGE_PREFIX)
  return createRequire(sdkEntry).resolve(specifier)
}

export type RunClaude = (
  command: string,
  args: string[],
  options: { env: Record<string, string>; timeoutMs: number },
) => Promise<{ stdout: string }>

/**
 * Runs the binary and returns its stdout. A non-zero exit still resolves: `auth status` exits 1
 * when nobody is logged in and prints the same JSON. A spawn failure or timeout rejects.
 */
const defaultRun: RunClaude = (command, args, { env, timeoutMs }) =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { env, timeout: timeoutMs, windowsHide: true, maxBuffer: 256 * 1024, encoding: 'utf8' },
      (error, stdout) => {
        if (error && typeof error.code !== 'number') reject(error)
        else resolve({ stdout })
      },
    )
  })

export interface ClaudeLoginTestOptions {
  configDir?: string | undefined
  pathToClaudeCodeExecutable?: string | undefined
  /** Deadline for the whole check. Defaults to 10 s. */
  timeoutMs?: number
  /** Monotonic clock in ms. Defaults to `performance.now`. */
  now?: () => number
  /** Environment source for the allowlist. Defaults to `process.env`. */
  env?: Record<string, string | undefined>
  run?: RunClaude
  resolveBinary?: () => string | null
}

const DEFAULT_TIMEOUT_MS = 10_000

/** Only the method is read. Email, organisation and the like are present but never looked at. */
const AuthStatus = z.object({ authMethod: z.string(), loggedIn: z.boolean().optional() })

/**
 * Asks the Claude Code binary how it is signed in (`claude auth status`), with the same clean env
 * the model uses. Only a claude.ai subscription login passes: any other method means an env var
 * or config would bill someone else's key or token, so it is refused. The binary's output is
 * parsed for the method alone and never returned.
 */
export async function testClaudeCodeLogin({
  configDir,
  pathToClaudeCodeExecutable,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = () => performance.now(),
  env,
  run = defaultRun,
  resolveBinary = resolveBundledClaudeBinary,
}: ClaudeLoginTestOptions = {}): Promise<ProviderTestResult> {
  const command = pathToClaudeCodeExecutable || resolveBinary()
  if (!command) return { ok: false, reason: 'unreachable' }

  const started = now()
  let timer: ReturnType<typeof setTimeout> | undefined
  let stdout: string
  try {
    // The kill timeout alone is not enough: a runner that ignores it would hang forever.
    const deadline = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs)
    })
    const pending = run(command, ['auth', 'status'], {
      env: buildClaudeEnv({ ...(env ? { env } : {}), configDir }),
      timeoutMs,
    })
    // A late failure after the deadline must not become an unhandled rejection.
    pending.catch(() => {})
    const outcome = await Promise.race([pending, deadline])
    if (!outcome) return { ok: false, reason: 'unreachable' }
    stdout = outcome.stdout
  } catch {
    return { ok: false, reason: 'unreachable' }
  } finally {
    clearTimeout(timer)
  }
  const latencyMs = Math.max(0, Math.round(now() - started))

  let parsed: z.infer<typeof AuthStatus>
  try {
    parsed = AuthStatus.parse(JSON.parse(stdout))
  } catch {
    return { ok: false, reason: 'unexpected_response' }
  }
  if (parsed.authMethod === 'none' || parsed.loggedIn === false) {
    return { ok: false, reason: 'not_signed_in' }
  }
  if (parsed.authMethod !== 'claude.ai') return { ok: false, reason: 'wrong_auth_method' }
  return { ok: true, latencyMs }
}
