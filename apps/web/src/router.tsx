import {
  createBrowserHistory,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from '@tanstack/react-router'
import {
  ActivityPage,
  ApprovalsPage,
  ConnectionsPage,
  MemoryPage,
  NotFoundPage,
  RoutinesPage,
} from './pages/placeholders.tsx'
import { Shell } from './shell/Shell.tsx'
import { TeammatesView } from './teammates/TeammatesView.tsx'

// Teammates is the landing page and stays in the main chunk; Settings (dialogs, forms, the
// provider flows) loads when first opened.
const SettingsPage = lazyRouteComponent(() => import('./settings/SettingsPage.tsx'), 'SettingsPage')

const rootRoute = createRootRoute({ component: Shell, notFoundComponent: NotFoundPage })

const page = <P extends string>(path: P, component: () => React.ReactNode) =>
  createRoute({ getParentRoute: () => rootRoute, path, component })

const routeTree = rootRoute.addChildren([
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    beforeLoad: () => {
      throw redirect({ to: '/t' })
    },
  }),
  page('/t', TeammatesView),
  page('/activity', ActivityPage),
  page('/approvals', ApprovalsPage),
  page('/memory', MemoryPage),
  page('/routines', RoutinesPage),
  page('/connections', ConnectionsPage),
  page('/settings', SettingsPage),
])

/** Browser history in the app; memory history when `initialPath` is given (tests). */
export function createAppRouter({ initialPath }: { initialPath?: string } = {}) {
  return createRouter({
    routeTree,
    history:
      initialPath === undefined
        ? createBrowserHistory()
        : createMemoryHistory({ initialEntries: [initialPath] }),
  })
}

export type AppRouter = ReturnType<typeof createAppRouter>

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter
  }
}
