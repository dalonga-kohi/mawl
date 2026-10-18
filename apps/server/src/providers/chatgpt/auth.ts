import { randomUUID } from 'node:crypto'
import {
  type ChatGptAttemptStatus,
  type ChatGptStartResult,
  type CredentialId,
  newId,
} from '@faire/contracts'
import {
  beginSignIn,
  completeSignIn,
  createTokenManager,
  hasPlanUsage,
  parseStoredCredential,
  type RandomBytes,
  revokeWithRetry,
  type SignInAttempt,
  type SignInResult,
  type StoredChatGptCredential,
  serializeStoredCredential,
  systemRandom,
  type TokenManager,
  type TokenStore,
} from '@faire/core'
import { schema } from '@faire/db'
import { and, desc, eq } from 'drizzle-orm'
import type { Logger } from '../../logger.ts'
import { type SecretBox, SecretDecryptError } from '../../secrets/index.ts'
import {
  CredentialNotFoundError,
  CredentialUnreadableError,
  type ProvidersDb,
  SignInAttemptNotFoundError,
  SignInUnavailableError,
} from '../types.ts'
import { type LoopbackListener, type StartListener, startLoopbackListener } from './listener.ts'

const { providerCredentials, oauthClients } = schema

const PROVIDER = 'openai_chatgpt' as const
const ATTEMPT_TTL_MS = 10 * 60 * 1000
/** Finished attempts kept so the app can read their outcome. */
const KEEP_RESULTS = 20

export interface ChatGptOptions {
  /** The persisted `urn:uuid:` host id; null disables sign-in. */
  hostId: string | null
  port: number
  bindHost: string
  startListener?: StartListener
  /** Epoch ms. */
  now?: () => number
  random?: RandomBytes
  sleep?: (ms: number) => Promise<void>
  /** Schedules `fn`; the returned function cancels it. */
  setTimer?: (fn: () => void, ms: number) => () => void
  attemptTtlMs?: number
}

export interface ChatGptAuthDeps {
  db: ProvidersDb
  secretBox: SecretBox
  logger: Logger
  fetch?: typeof globalThis.fetch
  options: ChatGptOptions
}

export interface ChatGptAuth {
  start(): Promise<ChatGptStartResult>
  status(attemptId: string): ChatGptAttemptStatus
  /** The token manager that refreshes and persists this credential's OAuth tokens. */
  tokens(id: CredentialId): TokenManager
  /** Revokes the refresh token at OpenAI. True when confirmed, or when there was nothing to revoke. */
  revoke(id: CredentialId): Promise<boolean>
  /** Forgets the cached token manager of a deleted credential. */
  forget(id: CredentialId): void
  /** Ends a pending attempt and closes its listener. */
  close(): Promise<void>
}

/** `<table>:<id>`, so a ciphertext cannot be moved to another row (see SecretBox). */
const aad = (id: string) => `provider_credentials:${id}`

interface Attempt {
  id: string
  sign: SignInAttempt
  listener?: LoopbackListener
  cancelTimer?: () => void
  handled: boolean
}

export function createChatGptAuth({
  db,
  secretBox,
  logger,
  fetch = globalThis.fetch,
  options,
}: ChatGptAuthDeps): ChatGptAuth {
  const now = options.now ?? Date.now
  const random = options.random ?? systemRandom
  const startListener = options.startListener ?? startLoopbackListener
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const setTimer =
    options.setTimer ??
    ((fn: () => void, ms: number) => {
      const t = setTimeout(fn, ms)
      t.unref()
      return () => clearTimeout(t)
    })
  const ttl = options.attemptTtlMs ?? ATTEMPT_TTL_MS

  const results = new Map<string, ChatGptAttemptStatus>()
  let current: Attempt | undefined
  /** Serialises start(): a second start must see the first attempt to cancel it. */
  let starting: Promise<unknown> = Promise.resolve()
  const managers = new Map<CredentialId, TokenManager>()

  function record(id: string, status: ChatGptAttemptStatus): void {
    results.set(id, status)
    for (const key of results.keys()) {
      if (results.size <= KEEP_RESULTS) break
      results.delete(key)
    }
  }

  /** Marks the attempt finished (once), stops its timer and closes its listener. */
  async function finish(attempt: Attempt, status: ChatGptAttemptStatus): Promise<void> {
    if (results.get(attempt.id)?.status !== 'pending') return
    record(attempt.id, status)
    attempt.cancelTimer?.()
    if (current === attempt) current = undefined
    logger.info(
      {
        attemptId: attempt.id,
        outcome: status.status === 'failed' ? status.reason : status.status,
      },
      'chatgpt sign-in finished',
    )
    await attempt.listener?.close().catch(() => {})
  }

  async function savedClientId(): Promise<string | null> {
    const [row] = await db
      .select({ clientId: oauthClients.clientId })
      .from(oauthClients)
      .where(eq(oauthClients.provider, PROVIDER))
      .orderBy(desc(oauthClients.createdAt))
      .limit(1)
    return row?.clientId ?? null
  }

  async function saveClientId(clientId: string): Promise<void> {
    await db.insert(oauthClients).values({ clientId, provider: PROVIDER }).onConflictDoNothing()
  }

  /** Creates the credential for a signed-in client, or refreshes the one it already has. */
  async function persist(result: Extract<SignInResult, { ok: true }>): Promise<CredentialId> {
    const secretFor = (id: string) =>
      secretBox.encrypt(serializeStoredCredential(result.credential), aad(id))
    const [existing] = await db
      .select({ id: providerCredentials.id })
      .from(providerCredentials)
      .where(eq(providerCredentials.oauthClientId, result.clientId))
    if (existing) {
      await db
        .update(providerCredentials)
        .set({
          secretEnc: secretFor(existing.id),
          accountEmail: result.accountEmail,
          planUsage: result.planUsage,
          reauthRequired: false,
        })
        .where(eq(providerCredentials.id, existing.id))
      managers.delete(existing.id)
      return existing.id
    }
    const id = newId('credential')
    await db.insert(providerCredentials).values({
      id,
      provider: PROVIDER,
      label: 'ChatGPT',
      secretEnc: secretFor(id),
      accountEmail: result.accountEmail,
      planUsage: result.planUsage,
      oauthClientId: result.clientId,
    })
    return id
  }

  async function onCallback(attempt: Attempt, params: URLSearchParams): Promise<void> {
    if (attempt.handled || results.get(attempt.id)?.status !== 'pending') return
    attempt.handled = true
    attempt.cancelTimer?.()
    try {
      const result = await completeSignIn(attempt.sign, params, { fetch, now, saveClientId })
      if (!result.ok) return await finish(attempt, { status: 'failed', reason: result.reason })
      const credentialId = await persist(result)
      await finish(attempt, { status: 'succeeded', credentialId })
    } catch (err) {
      // Name only: messages of unexpected errors can carry values we must not log.
      logger.error(
        { attemptId: attempt.id, errName: err instanceof Error ? err.name : 'unknown' },
        'chatgpt sign-in crashed',
      )
      await finish(attempt, { status: 'failed', reason: 'exchange_failed' })
    }
  }

  async function startNow(): Promise<ChatGptStartResult> {
    if (!options.hostId) throw new SignInUnavailableError('not_configured')
    if (current) await finish(current, { status: 'failed', reason: 'cancelled' })
    const sign = beginSignIn({
      clientId: await savedClientId(),
      hostId: options.hostId,
      port: options.port,
      random,
    })
    const attempt: Attempt = { id: randomUUID(), sign, handled: false }
    record(attempt.id, { status: 'pending' })
    current = attempt
    try {
      attempt.listener = await startListener({
        host: options.bindHost,
        port: options.port,
        onCallback: (params) => onCallback(attempt, params),
      })
    } catch (err) {
      logger.error(
        { attemptId: attempt.id, errName: err instanceof Error ? err.name : 'unknown' },
        'chatgpt sign-in listener failed',
      )
      await finish(attempt, { status: 'failed', reason: 'listener_failed' })
      throw new SignInUnavailableError('listener_failed')
    }
    attempt.cancelTimer = setTimer(() => {
      void finish(attempt, { status: 'failed', reason: 'expired' })
    }, ttl)
    logger.info({ attemptId: attempt.id }, 'chatgpt sign-in started')
    return { attemptId: attempt.id, authorizeUrl: sign.authorizeUrl }
  }

  async function load(id: CredentialId): Promise<StoredChatGptCredential> {
    const [row] = await db
      .select({ secretEnc: providerCredentials.secretEnc })
      .from(providerCredentials)
      .where(and(eq(providerCredentials.id, id), eq(providerCredentials.provider, PROVIDER)))
    if (!row) throw new CredentialNotFoundError(id)
    try {
      return parseStoredCredential(secretBox.decrypt(row.secretEnc, aad(id)))
    } catch (err) {
      logger.error(
        { credentialId: id, errName: err instanceof Error ? err.name : 'unknown' },
        'chatgpt credential could not be read',
      )
      if (err instanceof SecretDecryptError || err instanceof SyntaxError || isZod(err)) {
        throw new CredentialUnreadableError(id)
      }
      throw err
    }
  }

  async function write(
    id: CredentialId,
    next: StoredChatGptCredential,
    reauthRequired: boolean,
  ): Promise<void> {
    await db
      .update(providerCredentials)
      .set({
        secretEnc: secretBox.encrypt(serializeStoredCredential(next), aad(id)),
        planUsage: hasPlanUsage(next.scope),
        reauthRequired,
      })
      .where(eq(providerCredentials.id, id))
  }

  function storeFor(id: CredentialId): TokenStore {
    return {
      load: () => load(id),
      save: (next) => write(id, next, false),
      async clearTokens() {
        const current = await load(id)
        await write(
          id,
          { ...current, accessToken: null, refreshToken: null, idToken: null, expiresAt: 0 },
          true,
        )
        logger.warn({ credentialId: id }, 'chatgpt tokens cleared, sign-in needed')
      },
    }
  }

  return {
    start() {
      const run = starting.then(startNow)
      starting = run.catch(() => {})
      return run
    },

    status(attemptId) {
      const status = results.get(attemptId)
      if (!status) throw new SignInAttemptNotFoundError(attemptId)
      return status
    },

    tokens(id) {
      let manager = managers.get(id)
      if (!manager) {
        manager = createTokenManager({
          credentialId: id,
          store: storeFor(id),
          fetch,
          now,
        })
        managers.set(id, manager)
      }
      return manager
    },

    async revoke(id) {
      const stored = await load(id)
      if (!stored.refreshToken) return true
      const confirmed = await revokeWithRetry({
        fetch,
        clientId: stored.clientId,
        refreshToken: stored.refreshToken,
        sleep,
      })
      if (confirmed) logger.info({ credentialId: id }, 'chatgpt token revoked')
      else logger.warn({ credentialId: id }, 'chatgpt token revocation not confirmed')
      return confirmed
    },

    forget(id) {
      managers.delete(id)
    },

    async close() {
      if (current) await finish(current, { status: 'failed', reason: 'cancelled' })
    },
  }
}

function isZod(err: unknown): boolean {
  return err instanceof Error && err.name === 'ZodError'
}
