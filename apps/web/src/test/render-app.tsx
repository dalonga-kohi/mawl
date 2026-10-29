import type { Approval, Profile, ProviderCredential, UserProfile } from '@mawl/contracts'
import { QueryClient } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../App.tsx'
import type { Api } from '../api/ApiProvider.tsx'
import { createAppRouter } from '../router.tsx'
import { fakeApprovalsApi } from './fake-approvals-api.ts'
import { fakeChatApi } from './fake-chat-api.ts'
import { fakeProvidersApi } from './fake-providers-api.ts'
import { fakeUserApi } from './fake-user-api.ts'

/** A whole fake backend: providers plus profiles, threads, runs and the live stream. */
export function fakeApi(
  options: {
    credentials?: ProviderCredential[]
    profiles?: Profile[]
    user?: UserProfile
    approvals?: Approval[]
  } = {},
) {
  const providers = fakeProvidersApi(options.credentials)
  const approvals = fakeApprovalsApi(options.approvals)
  const chat = fakeChatApi(options.profiles ? { profiles: options.profiles } : {})
  const owner = fakeUserApi(options.user)
  const api: Api = {
    providers: providers.api,
    user: owner.api,
    approvals: approvals.api,
    ...chat.api,
    // The fake stream hands the app's query cache to the approvals fake, like the event store.
    live: (client) => {
      approvals.attach(client)
      return chat.api.live(client)
    },
  }
  return {
    api,
    approvals,
    providers: providers.state,
    chat: chat.state,
    server: chat.server,
    user: owner.state,
  }
}

/**
 * Renders the whole app at `path` with in-memory history, as a user would see it. Parts of the API
 * not given come from a fresh {@link fakeApi}.
 */
export async function renderApp(path = '/', partial: Partial<Api> = {}) {
  const api: Api = { ...fakeApi().api, ...partial }
  const router = createAppRouter({ initialPath: path })
  const user = userEvent.setup()
  // No retries in tests: a failing call should show its error state at once.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(<App router={router} api={api} queryClient={queryClient} />)
  await router.load()
  return { ...view, router, user, queryClient }
}

/** Makes `matchMedia` answer as a viewport of the given width (min-width queries only). */
export function stubViewport(width: number) {
  window.matchMedia = (query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query)
    const matches = min ? width >= Number(min[1]) : false
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }
  }
}
