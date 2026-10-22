import {
  type ChatGptAttemptStatus,
  type ChatGptStartResult,
  type CredentialId,
  newId,
  type ProviderCredential,
  type ProviderCredentialInput,
  type ProviderCredentialRemoved,
  type ProviderFailureReason,
  type ProviderTestInput,
  type ProviderTestResult,
} from '@mawl/contracts'
import {
  type ClaudeLoginTestOptions,
  type ClaudeQueryFn,
  createLanguageModel,
  type ProviderConnection,
  ProviderFailureError,
  resolveBaseUrl,
  testCredential,
} from '@mawl/core'
import { schema } from '@mawl/db'
import { asc, eq } from 'drizzle-orm'
import type { Logger } from '../logger.ts'
import { type SecretBox, SecretDecryptError } from '../secrets/index.ts'
import { type ChatGptOptions, createChatGptAuth } from './chatgpt/auth.ts'
import { createGuardedFetch, EgressBlockedError, type ResolveHost } from './egress/guarded-fetch.ts'
import { CredentialNotFoundError, CredentialUnreadableError, type ProvidersDb } from './types.ts'

export {
  CredentialNotFoundError,
  CredentialUnreadableError,
  type ProvidersDb,
  SignInAttemptNotFoundError,
  SignInUnavailableError,
} from './types.ts'

const { providerCredentials, providerCredentialPublicColumns } = schema

/** The AI SDK language model (LanguageModelV4) that core builds. */
type LanguageModel = ReturnType<typeof createLanguageModel>
export interface ProviderServiceDeps {
  db: ProvidersDb
  secretBox: SecretBox
  logger: Logger
  /**
   * Used for key tests only; defaults to the global fetch, and for an owner-typed url to the
   * guarded fetch's pinned transport. Tests inject it (the guard still vets the address first).
   */
  fetch?: typeof globalThis.fetch
  /** DNS for the SSRF guard. Defaults to the system resolver; tests inject a fake one. */
  resolveHost?: ResolveHost
  /** The per-process token bucket on `test`. Defaults: 10 at once, one more every 3 s. */
  testRateLimit?: TestRateLimitOptions
  /** Sign in with ChatGPT. Without a host id the sign-in cannot start. */
  chatgpt?: ChatGptOptions
  /**
   * Claude subscription via the Claude Code binary: where its login and the binary live. Neither
   * is a secret. The test seams (query, un, esolveBinary) keep tests from spawning it.
   */
  claudeCode?: ClaudeCodeOptions
}

export interface ClaudeCodeOptions
  extends Pick<
    ClaudeLoginTestOptions,
    'configDir' | 'pathToClaudeCodeExecutable' | 'run' | 'resolveBinary'
  > {
  query?: ClaudeQueryFn
  /** The login check the model runs before a query. Tests inject it so the binary never spawns. */
  checkLogin?: () => Promise<ProviderTestResult>
  /**
   * Finds (desktop: installs on first use) the binary's path, called only when a Claude plan
   * credential is tested or turned into a model, never at boot. It wins over
   * `pathToClaudeCodeExecutable`; undefined falls back to that and then to core's lookup. The
   * signal fires on `abortPending()` and `close()` (server shutdown), so a download ends then. A
   * rejection is reported as unreachable (test) or a provider error (model), and its message is
   * never logged.
   */
  resolveExecutable?: (signal: AbortSignal) => Promise<string | undefined>
}

export type TestTarget = ProviderTestInput

export interface TestRateLimitOptions {
  capacity?: number
  refillMs?: number
  /** Monotonic ms clock. Defaults to performance.now. */
  now?: () => number
}

/** `test` was called too often; nothing was looked up or sent. */
export class ProviderTestRateLimitedError extends Error {
  constructor() {
    super('Too many provider tests; try again shortly')
    this.name = 'ProviderTestRateLimitedError'
  }
}

/** A small token bucket: `capacity` at once, one more every `refillMs`. */
function tokenBucket({
  capacity = 10,
  refillMs = 3000,
  now = () => performance.now(),
}: TestRateLimitOptions) {
  let tokens = capacity
  let last = now()
  return {
    take(): boolean {
      const t = now()
      const gained = Math.floor((t - last) / refillMs)
      if (gained > 0) {
        tokens = Math.min(capacity, tokens + gained)
        last = tokens === capacity ? t : last + gained * refillMs
      }
      if (tokens < 1) return false
      tokens--
      return true
    },
  }
}

/**
 * Whether a key test may skip the SSRF guard: only when the url it calls is the provider's own
 * default (a constant, such as Ollama on localhost), never one the owner typed.
 */
function isDefaultUrl(conn: ProviderConnection): boolean {
  if (conn.baseUrl === null) return true
  try {
    return resolveBaseUrl(conn.kind, conn.baseUrl) === resolveBaseUrl(conn.kind, null)
  } catch {
    return false
  }
}

export interface ProviderService {
  list(): Promise<ProviderCredential[]>
  create(input: ProviderCredentialInput): Promise<ProviderCredential>
  /** Logout for a ChatGPT credential: revokes the refresh token, then deletes the row regardless. */
  delete(id: CredentialId): Promise<ProviderCredentialRemoved>
  test(target: TestTarget): Promise<ProviderTestResult>
  /**
   * Decrypts a stored credential for the run engine. Internal: never exposed over RPC, and
   * the result must not be logged or serialised. A ChatGPT credential has no plain secret:
   * its tokens stay inside the token manager, reached through `createModel`.
   */
  resolveCredential(id: CredentialId): Promise<ProviderConnection>
  /**
   * The AI SDK model for a stored credential. For ChatGPT it refreshes tokens as needed and
   * fails with a ProviderFailureError (closed reason) when the plan cannot be used.
   */
  createModel(id: CredentialId, modelId: string): Promise<LanguageModel>
  startChatGptSignIn(): Promise<ChatGptStartResult>
  /** Throws SignInAttemptNotFoundError for an unknown id. */
  chatGptSignInStatus(attemptId: string): ChatGptAttemptStatus
  /**
   * Aborts any Claude binary download in flight (and refuses new ones). Call first on shutdown, so
   * a run waiting for the binary does not hold the worker's stop. Idempotent.
   */
  abortPending(): void
  /** Ends a pending sign-in attempt and aborts pending downloads. Call on shutdown. */
  close(): Promise<void>
}

/** `<table>:<id>`, so a ciphertext cannot be moved to another row (see SecretBox). */
const aad = (id: string) => `provider_credentials:${id}`

type PublicRow = {
  id: CredentialId
  provider: ProviderCredential['provider']
  label: string
  baseUrl: string | null
  accountEmail: string | null
  planUsage: boolean
  reauthRequired: boolean
  createdAt: Date
}

const toPublic = (row: PublicRow): ProviderCredential => ({
  id: row.id,
  provider: row.provider,
  label: row.label,
  baseUrl: row.baseUrl,
  accountEmail: row.accountEmail,
  planUsage: row.planUsage,
  reauthRequired: row.reauthRequired,
  createdAt: row.createdAt.toISOString(),
})

/** Log fields for a failed executable lookup: a typed code when there is one, never the message. */
function executableFailure(err: unknown): { errName: string; code?: unknown } {
  const code = (err as { code?: unknown } | null)?.code
  return {
    errName: err instanceof Error ? err.name : 'unknown',
    ...(typeof code === 'string' ? { code } : {}),
  }
}

/** A token problem is reported as the closest key-test outcome; the reason is never leaked. */
function testFailureFor(reason: ProviderFailureReason): ProviderTestResult {
  if (reason === 'temporarily_unavailable') return { ok: false, reason: 'unreachable' }
  if (reason === 'provider_error') return { ok: false, reason: 'unexpected_response' }
  return { ok: false, reason: 'invalid_key' }
}

export function createProviderService({
  db,
  secretBox,
  logger,
  fetch,
  resolveHost,
  testRateLimit = {},
  chatgpt: chatgptOptions,
  claudeCode,
}: ProviderServiceDeps): ProviderService {
  const testBucket = tokenBucket(testRateLimit)
  const chatgpt = createChatGptAuth({
    db,
    secretBox,
    logger,
    ...(fetch ? { fetch } : {}),
    options: chatgptOptions ?? { hostId: null, port: 0, bindHost: '127.0.0.1' },
  })

  /** The Claude options for core, with the executable resolved now (and only for the Claude plan). */
  const installs = new AbortController()

  async function claudeOptionsFor(
    kind: ProviderConnection['kind'],
  ): Promise<Omit<ClaudeCodeOptions, 'resolveExecutable'> | undefined> {
    if (!claudeCode) return undefined
    const { resolveExecutable, ...rest } = claudeCode
    if (kind !== 'anthropic_claude_code' || !resolveExecutable) return rest
    const path = await resolveExecutable(installs.signal)
    return path ? { ...rest, pathToClaudeCodeExecutable: path } : rest
  }

  async function resolveCredential(id: CredentialId): Promise<ProviderConnection> {
    const [row] = await db
      .select({
        provider: providerCredentials.provider,
        baseUrl: providerCredentials.baseUrl,
        secretEnc: providerCredentials.secretEnc,
      })
      .from(providerCredentials)
      .where(eq(providerCredentials.id, id))
    if (!row) throw new CredentialNotFoundError(id)
    // OAuth tokens never leave the token manager as a plain secret.
    if (row.provider === 'openai_chatgpt')
      return { kind: row.provider, baseUrl: null, secret: null }
    let secret: string
    try {
      secret = secretBox.decrypt(row.secretEnc, aad(id))
    } catch (err) {
      // Name only: never the message, never the blob.
      logger.error(
        { credentialId: id, errName: err instanceof Error ? err.name : 'unknown' },
        'provider credential could not be decrypted',
      )
      if (err instanceof SecretDecryptError) throw new CredentialUnreadableError(id)
      throw err
    }
    return { kind: row.provider, baseUrl: row.baseUrl, secret: secret === '' ? null : secret }
  }

  return {
    async list() {
      const rows = await db
        .select(providerCredentialPublicColumns)
        .from(providerCredentials)
        .orderBy(asc(providerCredentials.createdAt), asc(providerCredentials.id))
      return rows.map(toPublic)
    },

    async create(input) {
      if (input.provider === 'openai_chatgpt') {
        throw new Error('openai_chatgpt credentials come only from Sign in with ChatGPT')
      }
      const id = newId('credential')
      const secretEnc = secretBox.encrypt(input.secret ?? '', aad(id))
      const [row] = await db
        .insert(providerCredentials)
        .values({
          id,
          provider: input.provider,
          label: input.label,
          secretEnc,
          baseUrl: input.baseUrl ?? null,
        })
        .returning(providerCredentialPublicColumns)
      if (!row) throw new Error('insert returned no row')
      logger.info({ credentialId: id, provider: input.provider }, 'provider credential created')
      return toPublic(row)
    },

    async delete(id) {
      const [existing] = await db
        .select({ provider: providerCredentials.provider })
        .from(providerCredentials)
        .where(eq(providerCredentials.id, id))
      let revoked = true
      if (existing?.provider === 'openai_chatgpt') {
        // Best effort: logout must always remove the local credential.
        revoked = await chatgpt.revoke(id).catch((err: unknown) => {
          logger.warn(
            { credentialId: id, errName: err instanceof Error ? err.name : 'unknown' },
            'chatgpt token revocation not confirmed',
          )
          return false
        })
      }
      const [row] = await db
        .delete(providerCredentials)
        .where(eq(providerCredentials.id, id))
        .returning(providerCredentialPublicColumns)
      if (!row) throw new CredentialNotFoundError(id)
      chatgpt.forget(id)
      logger.info({ credentialId: id, provider: row.provider }, 'provider credential deleted')
      return { ...toPublic(row), revoked }
    },

    async test(target) {
      // Before any lookup or request: a key test must not become a scanner.
      if (!testBucket.take()) throw new ProviderTestRateLimitedError()
      let conn: ProviderConnection
      if ('id' in target) {
        conn = await resolveCredential(target.id)
        if (conn.kind === 'openai_chatgpt') {
          try {
            conn = { ...conn, secret: await chatgpt.tokens(target.id).getAccessToken() }
          } catch (err) {
            if (!(err instanceof ProviderFailureError)) throw err
            const result = testFailureFor(err.reason)
            logger.info(
              { provider: conn.kind, ok: false, reason: err.reason },
              'provider credential tested',
            )
            return result
          }
        }
      } else {
        if (target.provider === 'openai_chatgpt') {
          throw new Error('openai_chatgpt credentials come only from Sign in with ChatGPT')
        }
        conn = {
          kind: target.provider,
          baseUrl: target.baseUrl ?? null,
          secret: target.secret ?? null,
        }
      }
      let claude: Awaited<ReturnType<typeof claudeOptionsFor>>
      try {
        claude = await claudeOptionsFor(conn.kind)
      } catch (err) {
        logger.warn(executableFailure(err), 'claude binary unavailable')
        return { ok: false, reason: 'unreachable' }
      }
      // SSRF guard for any url the owner typed: resolved once, metadata and link-local refused,
      // private networks only with the opt-in. A stored credential was saved by the owner, so
      // its private address stays testable; an unsaved one needs `allowPrivateNetwork`.
      let blocked: EgressBlockedError | undefined
      let testFetch = fetch
      if (conn.kind !== 'anthropic_claude_code' && !isDefaultUrl(conn)) {
        const guarded = createGuardedFetch({
          allowPrivate: 'id' in target ? true : target.allowPrivateNetwork === true,
          ...(resolveHost ? { resolve: resolveHost } : {}),
          ...(fetch ? { transport: (url, init) => fetch(url.toString(), init) } : {}),
        })
        testFetch = (async (input: string | URL | Request, init?: RequestInit) => {
          try {
            return await guarded(input, init)
          } catch (err) {
            if (err instanceof EgressBlockedError) blocked = err
            throw err
          }
        }) as typeof globalThis.fetch
      }
      const tested = await testCredential(conn, {
        ...(testFetch ? { fetch: testFetch } : {}),
        ...(claude ? { claudeCode: claude } : {}),
      })
      const result: ProviderTestResult = blocked ? { ok: false, reason: 'blocked_address' } : tested
      logger.info(
        {
          provider: conn.kind,
          ok: result.ok,
          ...(result.ok ? {} : { reason: result.reason }),
          ...(blocked ? { why: blocked.why } : {}),
        },
        'provider credential tested',
      )
      return result
    },

    resolveCredential,

    async createModel(id, modelId) {
      const conn = await resolveCredential(id)
      let claude: Awaited<ReturnType<typeof claudeOptionsFor>>
      try {
        claude = await claudeOptionsFor(conn.kind)
      } catch (err) {
        logger.warn(executableFailure(err), 'claude binary unavailable')
        throw new ProviderFailureError('provider_error')
      }
      return createLanguageModel(conn, modelId, {
        ...(fetch ? { fetch } : {}),
        ...(claude ? { claudeCode: claude } : {}),
        ...(conn.kind === 'openai_chatgpt' ? { chatgpt: { tokens: chatgpt.tokens(id) } } : {}),
      })
    },

    startChatGptSignIn: () => chatgpt.start(),
    chatGptSignInStatus: (attemptId) => chatgpt.status(attemptId),
    abortPending: () => installs.abort(),
    close() {
      installs.abort()
      return chatgpt.close()
    },
  }
}
