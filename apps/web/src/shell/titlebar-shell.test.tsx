import { screen, waitFor, within } from '@testing-library/react'
import { MotionGlobalConfig } from 'motion/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { profile } from '../test/fake-chat-api.ts'
import { fakeApi, renderApp, stubViewport } from '../test/render-app.tsx'

const win = vi.hoisted(() => ({
  minimize: vi.fn(async () => {}),
  toggleMaximize: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  isMaximized: vi.fn(async () => false),
  isFocused: vi.fn(async () => true),
  onResized: vi.fn(async () => () => {}),
  onFocusChanged: vi.fn(async () => () => {}),
}))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => win }))

beforeEach(() => {
  MotionGlobalConfig.skipAnimations = true
  stubViewport(1440)
})
afterEach(() => {
  MotionGlobalConfig.skipAnimations = false
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
  document.documentElement.removeAttribute('data-titlebar')
})

const inDesktop = () => Object.assign(window, { __TAURI_INTERNALS__: {} })

describe('title bar in the app shell', () => {
  it('is absent in a browser', async () => {
    await renderApp('/t')
    expect(screen.queryByRole('toolbar', { name: 'Title bar' })).toBeNull()
    expect(document.documentElement.hasAttribute('data-titlebar')).toBe(false)
  })

  it('shows in the desktop app with navigation, Search and the open teammate', async () => {
    inDesktop()
    const fake = fakeApi({ profiles: [profile({ name: 'Inbox Sweeper', slug: 'inbox-sweeper' })] })
    await renderApp('/t/inbox-sweeper', fake.api)
    const bar = await screen.findByRole('toolbar', { name: 'Title bar' })
    expect(within(bar).getByRole('button', { name: 'Back' })).toBeTruthy()
    expect(within(bar).getByRole('button', { name: 'Forward' })).toBeTruthy()
    expect(within(bar).getByRole('button', { name: 'Search' })).toBeTruthy()
    await waitFor(() => expect(within(bar).getByText('Inbox Sweeper')).toBeTruthy())
  })

  it('toggles the sidebar and opens the palette from the bar', async () => {
    inDesktop()
    const { user } = await renderApp('/t')
    const bar = await screen.findByRole('toolbar', { name: 'Title bar' })
    expect(screen.getByRole('complementary', { name: 'Sidebar' })).toBeTruthy()
    await user.click(within(bar).getByRole('button', { name: 'Toggle sidebar' }))
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Sidebar' })).toBeNull())
    await user.click(within(bar).getByRole('button', { name: 'Search' }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  it('goes back through history and disables Back at the start', async () => {
    inDesktop()
    const { user, router } = await renderApp('/t')
    const bar = await screen.findByRole('toolbar', { name: 'Title bar' })
    const back = within(bar).getByRole('button', { name: 'Back' }) as HTMLButtonElement
    expect(back.disabled).toBe(true)
    await router.navigate({ to: '/settings' })
    await waitFor(() => expect(back.disabled).toBe(false))
    await user.click(back)
    await waitFor(() => expect(router.state.location.pathname).toBe('/t'))
  })
})
