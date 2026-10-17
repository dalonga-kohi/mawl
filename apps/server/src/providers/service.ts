import {
  type CredentialId,
  newId,
  type ProviderCredential,
  type ProviderCredentialInput,
  type ProviderTestResult,
} from '@faire/contracts'
import { type ProviderConnection, testCredential } from '@faire/core'
import { schema } from '@faire/db'
import { asc, eq } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import type { Logger } from '../logger.ts'
import type { SecretBox } from '../secrets/index.ts'

const { providerCredentials, providerCredentialPublicColumns } = schema

/** Works with node-postgres in production and PGlite in tests. */
export type ProvidersDb = PgDatabase<PgQueryResultHKT, typeof schema>

export class CredentialNotFoundError extends Error {
  constructor(readonly id: CredentialId) {
    super('Provider credential not found')
    this.name = 'CredentialNotFoundError'
  }
}

export interface ProviderServiceDeps {
  db: ProvidersDb
  secretBox: SecretBox
  logger: Logger
  /** Used for key tests only; defaults to the global fetch. */
  fetch?: typeof globalThis.fetch
}

export type TestTarget = { id: CredentialId } | ProviderCredentialInput

export interface ProviderService {
  list(): Promise<ProviderCredential[]>
  create(input: ProviderCredentialInput): Promise<ProviderCredential>
  delete(id: CredentialId): Promise<ProviderCredential>
  test(target: TestTarget): Promise<ProviderTestResult>
  /**
   * Decrypts a stored credential for the run engine. Internal: never exposed over RPC, and
   * the result must not be logged or serialised.
   */
  resolveCredential(id: CredentialId): Promise<ProviderConnection>
}

/** `<table>:<id>`, so a ciphertext cannot be moved to another row (see SecretBox). */
const aad = (id: string) => `provider_credentials:${id}`

type PublicRow = {
  id: CredentialId
  provider: ProviderCredential['provider']
  label: string
  baseUrl: string | null
  createdAt: Date
}

const toPublic = (row: PublicRow): ProviderCredential => ({
  id: row.id,
  provider: row.provider,
  label: row.label,
  baseUrl: row.baseUrl,
  createdAt: row.createdAt.toISOString(),
})

export function createProviderService({
  db,
  secretBox,
  logger,
  fetch,
}: ProviderServiceDeps): ProviderService {
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
    let secret: string
    try {
      secret = secretBox.decrypt(row.secretEnc, aad(id))
    } catch (err) {
      // Name only: never the message, never the blob.
      logger.error(
        { credentialId: id, errName: err instanceof Error ? err.name : 'unknown' },
        'provider credential could not be decrypted',
      )
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
      const [row] = await db
        .delete(providerCredentials)
        .where(eq(providerCredentials.id, id))
        .returning(providerCredentialPublicColumns)
      if (!row) throw new CredentialNotFoundError(id)
      logger.info({ credentialId: id, provider: row.provider }, 'provider credential deleted')
      return toPublic(row)
    },

    async test(target) {
      const conn: ProviderConnection =
        'id' in target
          ? await resolveCredential(target.id)
          : {
              kind: target.provider,
              baseUrl: target.baseUrl ?? null,
              secret: target.secret ?? null,
            }
      const result = await testCredential(conn, fetch ? { fetch } : {})
      logger.info(
        { provider: conn.kind, ok: result.ok, ...(result.ok ? {} : { reason: result.reason }) },
        'provider credential tested',
      )
      return result
    },

    resolveCredential,
  }
}
