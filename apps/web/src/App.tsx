import { RouterProvider } from '@tanstack/react-router'
import { AppearanceProvider } from './appearance/AppearanceProvider.tsx'
import type { AppRouter } from './router.tsx'
import { TooltipProvider } from './ui/Tooltip.tsx'

export function App({ router }: { router: AppRouter }) {
  return (
    <AppearanceProvider>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </AppearanceProvider>
  )
}
