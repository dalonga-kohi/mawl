import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../App.tsx'
import { createAppRouter } from '../router.tsx'

/** Renders the whole app at `path` with in-memory history, as a user would see it. */
export async function renderApp(path = '/') {
  const router = createAppRouter({ initialPath: path })
  const user = userEvent.setup()
  const view = render(<App router={router} />)
  await router.load()
  return { ...view, router, user }
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
