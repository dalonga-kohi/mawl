import type {
  SearchBackendStatus,
  SearchKeyClear,
  SearchKeyInput,
  SearchProviderKind,
  SearchStatus,
} from '@mawl/contracts'
import {
  braveSearch,
  chainedSearch,
  ddgsSearch,
  type SearchFetch,
  type SearchProvider,
  tavilySearch,
} from '@mawl/core'
import { schema } from '@mawl/db'
import { eq, sql } from 'drizzle-orm'
import type { Logger } from '../logger.ts'
import type { ProvidersDb } from '../providers/types.ts'
import type { SecretBox } from '../secrets/index.ts'

const { serviceCredentials } = schema

/** The keyed backends in the order the chain tries them, with their `service_credentials` row. */
const BACKENDS = [
  { provider: 'tavily', service: 'tavily_search', create: tavilySearch },
  { provider: 'brave', service: 'brave_search', create: braveSearch },
] as const satisfies readonly {
  provider: SearchProviderKind
  service: (typeof schema.SERVICE_KINDS)[number]
  create: (deps: { apiKey: string; fetch: SearchFetch }) => SearchProvider
}[]

type Backend = (typeof BACKENDS)[number]

const backendOf = (provider: SearchProviderKind): Backend => {
  const backend = BACKENDS.find((b) => b.provider === provider)
  if (!backend) throw new Error(`unknown search backend ${provider}`)
  return backend
}

/** Authenticated with the ciphertext, so a blob cannot be moved to another row. */
const aad = (backend: Backend) => `service_credentials:${backend.service}`

export interface SearchService {
  /** Each keyed backend's state, then the keyless fallback. Never returns a key. */
  status(): Promise<SearchStatus>
  /** Encrypts and stores one backend's key, replacing any earlier one. Input is contract-validated. */
  setKey(input: SearchKeyInput): Promise<SearchStatus>
  /** Removes one backend's key. Idempotent. */
  clearKey(input: SearchKeyClear): Promise<SearchStatus>
  /**
   * The search chain: Tavily and Brave when their stored key opens, then DDGS (always). Read per
   * call, so a new or cleared key applies at once.
   */
  provider(): Promise<SearchProvider>
  /**
   * Boot's master-key check for this store: 'empty' without keys, 'verified' when every stored key
   * decrypts, and a SecretDecryptError when any does not (boot then stops, see server.ts).
   */
  verifyMasterKey(): Promise<'verified' | 'empty'>
}

export interface SearchServiceDeps {
  db: ProvidersDb
  secretBox: SecretBox
  logger: Logger
  /** The fetch every search backend calls through (tests inject one). Default: the global fetch. */
  fetch?: SearchFetch
}

/**
 * The web search keys (Tavily, Brave), one encrypted `service_credentials` row each, and the
 * backend chain built from them. Keys are decrypted only here, on the way into a request header;
 * never logged or returned. DDGS is created once, so its cool-down after a block outlives a search.
 */
export function createSearchService({
  db,
  secretBox,
  logger,
  fetch = (url, init) => globalThis.fetch(url, init),
}: SearchServiceDeps): SearchService {
  const ddgs = ddgsSearch({ fetch })

  async function rows(): Promise<Map<string, { secretEnc: Uint8Array; updatedAt: Date }>> {
    const all = await db
      .select({
        service: serviceCredentials.service,
        secretEnc: serviceCredentials.secretEnc,
        updatedAt: serviceCredentials.updatedAt,
      })
      .from(serviceCredentials)
    return new Map(all.map((r) => [r.service, r]))
  }

  /** The key, or null when the blob does not open with this server's key. */
  function open(backend: Backend, secretEnc: Uint8Array): string | null {
    try {
      return secretBox.decrypt(secretEnc, aad(backend))
    } catch {
      return null
    }
  }

  async function status(): Promise<SearchStatus> {
    const stored = await rows()
    const backends = BACKENDS.map((backend): SearchBackendStatus => {
      const row = stored.get(backend.service)
      if (!row) {
        return { provider: backend.provider, configured: false, unreadable: false, updatedAt: null }
      }
      return {
        provider: backend.provider,
        configured: true,
        // The plaintext is dropped at once.
        unreadable: open(backend, row.secretEnc) === null,
        updatedAt: row.updatedAt.toISOString(),
      }
    })
    return { backends, fallback: 'ddgs' }
  }

  return {
    status,

    async setKey({ provider, apiKey }) {
      const backend = backendOf(provider)
      const secretEnc = secretBox.encrypt(apiKey, aad(backend))
      await db
        .insert(serviceCredentials)
        .values({ service: backend.service, secretEnc })
        .onConflictDoUpdate({
          target: serviceCredentials.service,
          set: { secretEnc, updatedAt: sql`now()` },
        })
      logger.info({ service: backend.service }, 'search key saved')
      return status()
    },

    async clearKey({ provider }) {
      const backend = backendOf(provider)
      await db.delete(serviceCredentials).where(eq(serviceCredentials.service, backend.service))
      return status()
    },

    async provider() {
      const stored = await rows()
      const chain: SearchProvider[] = []
      for (const backend of BACKENDS) {
        const row = stored.get(backend.service)
        if (!row) continue
        const apiKey = open(backend, row.secretEnc)
        if (apiKey === null) {
          // The master key changed: the owner sets the key again. No detail about the cause.
          logger.warn({ service: backend.service }, 'search key cannot be decrypted; set it again')
          continue
        }
        chain.push(backend.create({ apiKey, fetch }))
      }
      chain.push(ddgs)
      return chainedSearch(chain)
    },

    async verifyMasterKey() {
      const stored = await rows()
      let any = false
      for (const backend of BACKENDS) {
        const row = stored.get(backend.service)
        if (!row) continue
        any = true
        // Throws SecretDecryptError: one unreadable key fails the whole check.
        secretBox.decrypt(row.secretEnc, aad(backend))
      }
      return any ? 'verified' : 'empty'
    },
  }
}
