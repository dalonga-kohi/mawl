import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createContext, type ReactNode, useContext, useState } from 'react'
import type { ProvidersApi } from './providers-api.ts'

export interface Api {
  providers: ProvidersApi
}

const ApiContext = createContext<Api | null>(null)

export function createAppQueryClient() {
  return new QueryClient({
    defaultOptions: {
      // Live updates arrive over the event stream; refetch on focus only as a safety net.
      queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true },
      mutations: { retry: 0 },
    },
  })
}

/** Gives views the server API and a TanStack Query cache. Components never fetch ad hoc. */
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
  return (
    <ApiContext value={api}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </ApiContext>
  )
}

export function useApi(): Api {
  const api = useContext(ApiContext)
  if (!api) throw new Error('useApi must be used inside <ApiProvider>')
  return api
}
