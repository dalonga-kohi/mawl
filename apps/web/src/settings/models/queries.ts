import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useApi } from '../../api/ApiProvider.tsx'

export const providerKeys = {
  catalog: ['providers', 'catalog'] as const,
  list: ['providers', 'list'] as const,
}

export function useCatalog() {
  const { providers } = useApi()
  return useQuery({
    queryKey: providerKeys.catalog,
    queryFn: () => providers.catalog(),
    staleTime: Infinity,
  })
}

export function useCredentials() {
  const { providers } = useApi()
  return useQuery({ queryKey: providerKeys.list, queryFn: () => providers.list() })
}

export function useRefreshCredentials() {
  const client = useQueryClient()
  return () => client.invalidateQueries({ queryKey: providerKeys.list })
}
