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
  stripSearchParams,
} from '@tanstack/react-router'
import { ApprovalsPage } from './pages/ApprovalsPage.tsx'
import { MemoryPage, NotFoundPage } from './pages/placeholders.tsx'
import { RouteError, RoutePending } from './pages/route-fallbacks.tsx'
import { ScheduledPage } from './pages/ScheduledPage.tsx'
import {
  DEFAULT_SETTINGS_SECTION,
  validateApprovalsSearch,
  validateSettingsSearch,
  validateToolsSearch,
} from './pages/search.ts'
import { ToolsPage } from './pages/ToolsPage.tsx'
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

/** An old address that now lives on a tab of another page. */
const moved = (path: '/activity' | '/connections', to: '/approvals' | '/tools', tab: string) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path,
    beforeLoad: () => {
      // reason: 	o is a union of two routes with different search types; both take a plain tab.
      throw redirect({ to, search: { tab } as never, replace: true })
    },
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
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/approvals',
    component: ApprovalsPage,
    validateSearch: validateApprovalsSearch,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/tools',
    component: ToolsPage,
    validateSearch: validateToolsSearch,
  }),
  moved('/activity', '/approvals', 'activity'),
  moved('/connections', '/tools', 'connections'),
  page('/memory', MemoryPage),
  page('/routines', ScheduledPage),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/settings',
    component: SettingsPage,
    validateSearch: validateSettingsSearch,
    // The default section is the bare /settings address, so links to it stay clean.
    search: {
      middlewares: [stripSearchParams({ section: DEFAULT_SETTINGS_SECTION })],
    },
  }),
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
