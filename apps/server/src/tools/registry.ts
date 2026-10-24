import {
  askUserTool,
  BlockedAddressError,
  createToolRegistry,
  notifyTool,
  readArtifactTool,
  type ToolGate,
  type ToolRegistry,
  type WebFetchDeps,
  webFetchTool,
  webSearchTool,
} from '@mawl/core'
import {
  createGuardedFetch,
  EgressBlockedError,
  type GuardedFetchOptions,
} from '../providers/egress/guarded-fetch.ts'
import type { ProvidersDb } from '../providers/types.ts'
import { createArtifactStore } from '../runs/artifacts.ts'
import type { SearchService } from '../search/service.ts'

/**
 * The fetch `web_fetch` uses: the SSRF guard with private networks refused (model-supplied urls
 * are hostile, unlike a base url the owner typed). It resolves and vets the name on every call and
 * never follows redirects, so the tool's per-hop loop re-vets every hop. The guard's refusal is
 * mapped to core's `BlockedAddressError`.
 */
export function guardedWebFetch(
  options: Omit<GuardedFetchOptions, 'allowPrivate'> = {},
): WebFetchDeps['fetch'] {
  const guarded = createGuardedFetch({ ...options, allowPrivate: false })
  return async (url, init) => {
    try {
      return await guarded(url, init)
    } catch (err) {
      if (err instanceof EgressBlockedError) throw new BlockedAddressError()
      throw err
    }
  }
}

export interface ServerToolsDeps {
  db: ProvidersDb
  search: Pick<SearchService, 'provider'>
  /** Default: the guarded fetch. Tests inject one. */
  webFetch?: WebFetchDeps['fetch']
  /** Default: allow everything until D2.3's policy engine. */
  gate?: ToolGate
}

/** The built-in tools every run gets (when its model supports tools). */
export function createServerTools({ db, search, webFetch, gate }: ServerToolsDeps): ToolRegistry {
  const artifacts = createArtifactStore(db)
  return createToolRegistry({
    tools: [
      webFetchTool({ fetch: webFetch ?? guardedWebFetch() }),
      webSearchTool({ provider: () => search.provider() }),
      notifyTool(),
      askUserTool(),
      readArtifactTool(artifacts),
    ],
    artifacts,
    ...(gate ? { gate } : {}),
  })
}
