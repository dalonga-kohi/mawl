import { ThreadId } from '@mawl/contracts'
import {
  createBrowserHistory,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  type RouteComponent,
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
import { RouteError, RoutePending } from './pages/route-fallbacks.tsx'
import { Shell } from './shell/Shell.tsx'
import { TeammatesIndex, TeammatesLayout } from './teammates/TeammatesView.tsx'

// The teammate list and landing state stay in the main chunk; a conversation (markdown, composer)
// and Settings (dialogs, forms, the provider flows) load when first opened.
const ChatView = lazyRouteComponent(() => import('./chat/ChatView.tsx'), 'ChatView')
const SettingsPage = lazyRouteComponent(() => import('./settings/SettingsPage.tsx'), 'SettingsPage')

const rootRoute = createRootRoute({ component: Shell, notFoundComponent: NotFoundPage })

const page = <P extends string>(path: P, component: RouteComponent) =>
  createRoute({ getParentRoute: () => rootRoute, path, component })

const teammatesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/t',
  component: TeammatesLayout,
})

/** `?thread=<id>` opens that conversation; `?thread=new` starts a fresh one. Anything else is dropped. */
export function chatSearch(search: Record<string, unknown>): { thread?: string } {
  const thread = search.thread
  return thread === 'new' || ThreadId.safeParse(thread).success ? { thread: thread as string } : {}
}

const chatRoute = createRoute({
  getParentRoute: () => teammatesRoute,
  path: '$slug',
  component: ChatView,
  validateSearch: chatSearch,
})

const routeTree = rootRoute.addChildren([
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    beforeLoad: () => {
      throw redirect({ to: '/t' })
    },
  }),
  teammatesRoute.addChildren([
    createRoute({ getParentRoute: () => teammatesRoute, path: '/', component: TeammatesIndex }),
    chatRoute,
  ]),
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
    defaultPendingComponent: RoutePending,
    defaultErrorComponent: RouteError,
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
