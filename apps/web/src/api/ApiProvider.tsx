import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react'
import type { ApprovalsApi } from './approvals-api.ts'
import type {
  LiveFactory,
  LiveStatus,
  LiveStore,
  ProfilesApi,
  RunsApi,
  ThreadsApi,
  UserApi,
} from './chat-api.ts'
import type { ProvidersApi } from './providers-api.ts'

export interface Api {
  providers: ProvidersApi
  /** The owner's own profile. */
  user: UserApi
  /** Teammates. */
  profiles: ProfilesApi
  threads: ThreadsApi
  runs: RunsApi
  /** Tool calls parked for the owner's decision. */
  approvals: ApprovalsApi
  /** Opens the live event stream for the app's query cache. */
  live: LiveFactory
}

const ApiContext = createContext<Api | null>(null)
const LiveContext = createContext<LiveStore | null>(null)

export function createAppQueryClient() {
  return new QueryClient({
    defaultOptions: {
      // Live updates arrive over the event stream; refetch on focus only as a safety net.
      queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true },
      mutations: { retry: 0 },
    },
  })
}

/**
 * Gives views the server API, a TanStack Query cache and the live event stream. The stream starts
 * with the provider and stops when it unmounts. Components never fetch ad hoc.
 */
export function ApiProvider({
  api,
  queryClient,
  children,
}: {
  api: Api
  queryClient?: QueryClient
  children: ReactNode
}) {
  const [client] = useState(() => queryClient ?? createAppQueryClient())
  const [live] = useState(() => api.live(client))
  useEffect(() => {
    live.start()
    return () => live.stop()
  }, [live])
  return (
    <ApiContext value={api}>
      <LiveContext value={live}>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </LiveContext>
    </ApiContext>
  )
}

export function useApi(): Api {
  const api = useContext(ApiContext)
  if (!api) throw new Error('useApi must be used inside <ApiProvider>')
  return api
}

export function useLive(): LiveStore {
  const live = useContext(LiveContext)
  if (!live) throw new Error('useLive must be used inside <ApiProvider>')
  return live
}

const NO_RUN = () => () => {}

/** Text streamed so far for a run; '' when nothing is streaming (or no run is given). */
export function useRunText(runId: string | undefined): string {
  const live = useLive()
  return useSyncExternalStore(
    runId ? (listener) => live.subscribeRunText(runId as never, listener) : NO_RUN,
    () => (runId ? live.getRunText(runId as never) : ''),
  )
}

export function useLiveStatus(): LiveStatus {
  const live = useLive()
  return useSyncExternalStore(
    (listener) => live.subscribeStatus(listener),
    () => live.status,
  )
}
