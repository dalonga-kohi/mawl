import type { SearchKeyInput, SearchStatus } from '@mawl/contracts'
import { braveSearch, type SearchProvider } from '@mawl/core'
import { schema } from '@mawl/db'
import { eq, sql } from 'drizzle-orm'
import type { Logger } from '../logger.ts'
import type { ProvidersDb } from '../providers/types.ts'
import type { SecretBox } from '../secrets/index.ts'

const { serviceCredentials } = schema

const SERVICE = 'brave_search' as const
/** Authenticated with the ciphertext, so a blob cannot be moved to another row. */
const AAD = `service_credentials:${SERVICE}`

export interface SearchService {
  /** Whether a key is stored. Never returns the key. */
  status(): Promise<SearchStatus>
  /** Encrypts and stores the key, replacing any earlier one. Input is contract-validated. */
  setKey(input: SearchKeyInput): Promise<SearchStatus>
  /** Removes the key. Idempotent. */
  clearKey(): Promise<SearchStatus>
  /** The Brave backend with the stored key, or null without a usable key. Read per call. */
  provider(): Promise<SearchProvider | null>
  /**
   * Boot's master-key check for this store: 'empty' without a key, 'verified' when it decrypts,
   * and a SecretDecryptError when it does not (boot then stops, see server.ts).
   */
  verifyMasterKey(): Promise<'verified' | 'empty'>
}

export interface SearchServiceDeps {
  db: ProvidersDb
  secretBox: SecretBox
  logger: Logger
  /** The fetch Brave calls go through (tests inject one). Default: the global fetch. */
  fetch?: (url: string, init: RequestInit) => Promise<Response>
}

const NONE: SearchStatus = {
  provider: 'brave',
  configured: false,
  unreadable: false,
  updatedAt: null,
}

/**
 * The web search key (Brave). Stored encrypted with the server's secret box, like provider keys;
 * decrypted only here, on the way into a search request header. Never logged or returned.
 */
export function createSearchService({
  db,
  secretBox,
  logger,
  fetch = (url, init) => globalThis.fetch(url, init),
}: SearchServiceDeps): SearchService {
  async function status(): Promise<SearchStatus> {
    const [row] = await db
      .select({ updatedAt: serviceCredentials.updatedAt, secretEnc: serviceCredentials.secretEnc })
      .from(serviceCredentials)
      .where(eq(serviceCredentials.service, SERVICE))
    if (!row) return NONE
    return {
      provider: 'brave',
      configured: true,
      unreadable: !opens(row.secretEnc),
      updatedAt: row.updatedAt.toISOString(),
    }
  }

  /** Whether the blob decrypts with this server's key. The plaintext is dropped at once. */
  function opens(secretEnc: Uint8Array): boolean {
    try {
      secretBox.decrypt(secretEnc, AAD)
      return true
    } catch {
      return false
    }
  }

  return {
    status,

    async setKey({ apiKey }) {
      const secretEnc = secretBox.encrypt(apiKey, AAD)
      await db
        .insert(serviceCredentials)
        .values({ service: SERVICE, secretEnc })
        .onConflictDoUpdate({
          target: serviceCredentials.service,
          set: { secretEnc, updatedAt: sql`now()` },
        })
      logger.info({ service: SERVICE }, 'search key saved')
      return status()
    },

    async clearKey() {
      await db.delete(serviceCredentials).where(eq(serviceCredentials.service, SERVICE))
      return NONE
    },

    async provider() {
      const [row] = await db
        .select({ secretEnc: serviceCredentials.secretEnc })
        .from(serviceCredentials)
        .where(eq(serviceCredentials.service, SERVICE))
      if (!row) return null
      let apiKey: string
      try {
        apiKey = secretBox.decrypt(row.secretEnc, AAD)
      } catch {
        // The master key changed: the owner sets the key again. No detail about the cause.
        logger.warn({ service: SERVICE }, 'search key cannot be decrypted; set it again')
        return null
      }
      return braveSearch({ apiKey, fetch })
    },

    async verifyMasterKey() {
      const [row] = await db
        .select({ secretEnc: serviceCredentials.secretEnc })
        .from(serviceCredentials)
        .where(eq(serviceCredentials.service, SERVICE))
      if (!row) return 'empty'
      secretBox.decrypt(row.secretEnc, AAD)
      return 'verified'
    },
  }
}
