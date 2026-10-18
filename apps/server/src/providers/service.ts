import {
  type ChatGptAttemptStatus,
  type ChatGptStartResult,
  type CredentialId,
  newId,
  type ProviderCredential,
  type ProviderCredentialInput,
  type ProviderFailureReason,
  type ProviderTestResult,
} from '@faire/contracts'
import {
  createLanguageModel,
  type ProviderConnection,
  ProviderFailureError,
  testCredential,
} from '@faire/core'
import { schema } from '@faire/db'
import { asc, eq } from 'drizzle-orm'
import type { Logger } from '../logger.ts'
import { type SecretBox, SecretDecryptError } from '../secrets/index.ts'
import { type ChatGptOptions, createChatGptAuth } from './chatgpt/auth.ts'
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
  /** Used for key tests only; defaults to the global fetch. */
  fetch?: typeof globalThis.fetch
  /** Sign in with ChatGPT. Without a host id the sign-in cannot start. */
  chatgpt?: ChatGptOptions
}

export type TestTarget = { id: CredentialId } | ProviderCredentialInput

export interface ProviderService {
  list(): Promise<ProviderCredential[]>
  create(input: ProviderCredentialInput): Promise<ProviderCredential>
  /** Logout for a ChatGPT credential: revokes the refresh token, then deletes the row regardless. */
  delete(id: CredentialId): Promise<ProviderCredential>
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
  /** Ends a pending sign-in attempt. Call on shutdown. */
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
  chatgpt: chatgptOptions,
}: ProviderServiceDeps): ProviderService {
  const chatgpt = createChatGptAuth({
    db,
    secretBox,
    logger,
    ...(fetch ? { fetch } : {}),
    options: chatgptOptions ?? { hostId: null, port: 0, bindHost: '127.0.0.1' },
  })

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
      if (existing?.provider === 'openai_chatgpt') {
        // Best effort: logout must always remove the local credential.
        await chatgpt.revoke(id).catch((err: unknown) => {
          logger.warn(
            { credentialId: id, errName: err instanceof Error ? err.name : 'unknown' },
            'chatgpt token revocation not confirmed',
          )
        })
      }
      const [row] = await db
        .delete(providerCredentials)
        .where(eq(providerCredentials.id, id))
        .returning(providerCredentialPublicColumns)
      if (!row) throw new CredentialNotFoundError(id)
      chatgpt.forget(id)
      logger.info({ credentialId: id, provider: row.provider }, 'provider credential deleted')
      return toPublic(row)
    },

    async test(target) {
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
      const result = await testCredential(conn, fetch ? { fetch } : {})
      logger.info(
        { provider: conn.kind, ok: result.ok, ...(result.ok ? {} : { reason: result.reason }) },
        'provider credential tested',
      )
      return result
    },

    resolveCredential,

    async createModel(id, modelId) {
      const conn = await resolveCredential(id)
      return createLanguageModel(conn, modelId, {
        ...(fetch ? { fetch } : {}),
        ...(conn.kind === 'openai_chatgpt' ? { chatgpt: { tokens: chatgpt.tokens(id) } } : {}),
      })
    },

    startChatGptSignIn: () => chatgpt.start(),
    chatGptSignInStatus: (attemptId) => chatgpt.status(attemptId),
    close: () => chatgpt.close(),
  }
}
