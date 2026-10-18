import type { QueryClient } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { type Api, ApiProvider } from './api/ApiProvider.tsx'
import { AppearanceProvider } from './appearance/AppearanceProvider.tsx'
import type { AppRouter } from './router.tsx'
import { TooltipProvider } from './ui/Tooltip.tsx'

export function App({
  router,
  api,
  queryClient,
}: {
  router: AppRouter
  api: Api
  queryClient?: QueryClient
}) {
  return (
    <AppearanceProvider>
      <ApiProvider api={api} {...(queryClient ? { queryClient } : {})}>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </ApiProvider>
    </AppearanceProvider>
  )
}
