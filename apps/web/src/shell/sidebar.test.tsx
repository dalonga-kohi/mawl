import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { profile, thread } from '../test/fake-chat-api.ts'
import { fakeApi, renderApp, stubViewport } from '../test/render-app.tsx'

beforeEach(() => stubViewport(1440))
afterEach(() => vi.restoreAllMocks())

const sweeper = () => profile({ name: 'Inbox Sweeper', slug: 'inbox-sweeper' })
const scout = () => profile({ name: 'Scout', slug: 'scout' })

const sidebar = () => screen.getByRole('complementary', { name: 'Sidebar' })

describe('sidebar', () => {
  it('shows the Mawl wordmark and the nav in order, with no New chat button', async () => {
    await renderApp('/t')
    const bar = sidebar()
    expect(within(bar).getByText('Mawl')).toBeTruthy()
    expect(within(bar).queryByRole('button', { name: 'New chat' })).toBeNull()
    const nav = within(bar).getByRole('navigation', { name: 'Main' })
    const labels = [...nav.querySelectorAll('a, button')].map((el) => el.textContent?.trim())
    expect(labels).toEqual([expect.stringMatching(/^Search/), 'Tools', 'Scheduled', 'Approvals'])
    expect(within(nav).queryByText('Memory')).toBeNull()
    expect(within(nav).queryByText('Activity')).toBeNull()
  })

  it('has no icon rail or bottom tab bar', async () => {
    await renderApp('/t')
    expect(document.querySelector('[data-rail]')).toBeNull()
    expect(screen.getAllByRole('navigation')).toHaveLength(1)
    expect(screen.queryByRole('link', { name: 'Teammates' })).toBeNull()
  })

  it('marks the open view in the nav', async () => {
    await renderApp('/approvals')
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'Approvals' }).getAttribute('aria-current')).toBe(
      'page',
    )
    expect(within(nav).getByRole('link', { name: 'Tools' }).getAttribute('aria-current')).toBeNull()
  })

  it('ends with one row: the profile button and a Settings gear', async () => {
    const { user, router } = await renderApp('/t')
    const profile = within(sidebar()).getByRole('button', { name: /Set your name/ })
    const gear = within(sidebar()).getByRole('link', { name: 'Settings' })
    expect(profile.parentElement).toBe(gear.parentElement)
    expect(gear.textContent?.trim()).toBe('')
    await user.click(gear)
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'))
    expect(
      within(sidebar()).getByRole('link', { name: 'Settings' }).getAttribute('aria-current'),
    ).toBe('page')
  })

  it('is flat: no floating rounded panel around the view', async () => {
    await renderApp('/t')
    expect(document.querySelector('.rounded-panel')).toBeNull()
  })
})
describe('hiding the sidebar', () => {
  it('hides with the button, shows again from the page header, and remembers', async () => {
    const { user, unmount } = await renderApp('/t')
    await user.click(within(sidebar()).getByRole('button', { name: 'Hide sidebar' }))
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Sidebar' })).toBeNull())
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
    expect(localStorage.getItem('mawl.sidebar')).toBe('closed')

    unmount()
    const again = await renderApp('/t')
    expect(screen.queryByRole('complementary', { name: 'Sidebar' })).toBeNull()
    await again.user.click(screen.getByRole('button', { name: 'Show sidebar' }))
    expect(await screen.findByRole('complementary', { name: 'Sidebar' })).toBeTruthy()
    expect(localStorage.getItem('mawl.sidebar')).toBe('open')
  })

  it('toggles with Ctrl+B and Cmd+B', async () => {
    const { user } = await renderApp('/t')
    await user.keyboard('{Control>}b{/Control}')
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Sidebar' })).toBeNull())
    await user.keyboard('{Control>}b{/Control}')
    expect(await screen.findByRole('complementary', { name: 'Sidebar' })).toBeTruthy()
    await user.keyboard('{Meta>}b{/Meta}')
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Sidebar' })).toBeNull())
  })

  it('works without usable storage', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const { user } = await renderApp('/t')
    expect(sidebar()).toBeTruthy()
    await user.click(within(sidebar()).getByRole('button', { name: 'Hide sidebar' }))
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Sidebar' })).toBeNull())
  })

  it('offers the show button on every page', async () => {
    localStorage.setItem('mawl.sidebar', 'closed')
    await renderApp('/settings')
    expect(screen.getByRole('button', { name: 'Show sidebar' })).toBeTruthy()
  })
})

describe('phone drawer', () => {
  it('opens from the header button and closes after navigating', async () => {
    stubViewport(390)
    const { user, router } = await renderApp('/approvals')
    expect(screen.queryByRole('complementary', { name: 'Sidebar' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Show sidebar' }))
    const drawer = await screen.findByRole('dialog', { name: 'Sidebar' })
    await user.click(within(drawer).getByRole('link', { name: 'Tools' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/tools'))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Sidebar' })).toBeNull())
  })

  it('closes with Escape and Ctrl+B', async () => {
    stubViewport(390)
    const { user } = await renderApp('/approvals')
    await user.click(screen.getByRole('button', { name: 'Show sidebar' }))
    await screen.findByRole('dialog', { name: 'Sidebar' })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Sidebar' })).toBeNull())
    await user.keyboard('{Control>}b{/Control}')
    expect(await screen.findByRole('dialog', { name: 'Sidebar' })).toBeTruthy()
  })
})

describe('teammates in the sidebar', () => {
  it('lists a row per teammate with the latest conversation', async () => {
    const fake = fakeApi({ profiles: [sweeper(), scout()] })
    const [first] = fake.chat.profiles
    if (!first) throw new Error('no profile')
    fake.chat.threads.push(
      thread(first.id, { title: 'Sort the inbox', lastEventAt: '2026-10-20T10:00:00.000Z' }),
    )
    await renderApp('/approvals', fake.api)
    const row = await within(sidebar()).findByRole('link', { name: /Inbox Sweeper/ })
    expect(await within(row).findByText('Sort the inbox')).toBeTruthy()
    expect(within(sidebar()).getByRole('link', { name: /Scout/ })).toBeTruthy()
    expect(within(sidebar()).queryByRole('region', { name: 'Pinned' })).toBeNull()
  })

  it('shows skeletons while loading, then the empty state with an add button', async () => {
    const { user } = await renderApp('/approvals')
    expect(await within(sidebar()).findByText('Your teammates will be listed here.')).toBeTruthy()
    await user.click(within(sidebar()).getByRole('button', { name: 'Add a teammate' }))
    expect(await screen.findByRole('dialog', { name: 'New teammate' })).toBeTruthy()
  })

  it('says what went wrong and retries', async () => {
    const fake = fakeApi({ profiles: [sweeper()] })
    fake.chat.profilesError = new Error('down')
    const { user } = await renderApp('/approvals', fake.api)
    expect((await within(sidebar()).findByRole('alert')).textContent).toMatch(/Couldn't load/)
    fake.chat.profilesError = null
    await user.click(within(sidebar()).getByRole('button', { name: 'Retry' }))
    expect(await within(sidebar()).findByRole('link', { name: /Inbox Sweeper/ })).toBeTruthy()
  })

  it('pins a teammate into Pinned and remembers it', async () => {
    const fake = fakeApi({ profiles: [sweeper(), scout()] })
    const { user, unmount } = await renderApp('/approvals', fake.api)
    await within(sidebar()).findByRole('link', { name: /Scout/ })
    await user.click(within(sidebar()).getByRole('button', { name: 'More actions for Scout' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Pin' }))
    const pinned = await within(sidebar()).findByRole('region', { name: 'Pinned' })
    expect(within(pinned).getByRole('link', { name: /Scout/ })).toBeTruthy()
    const group = within(sidebar()).getByRole('region', { name: 'Teammates' })
    expect(within(group).queryByRole('link', { name: /Scout/ })).toBeNull()

    unmount()
    const second = await renderApp('/approvals', fake.api)
    const again = await within(sidebar()).findByRole('region', { name: 'Pinned' })
    expect(within(again).getByRole('link', { name: /Scout/ })).toBeTruthy()

    // Unpin returns it to Teammates.
    await second.user.click(within(again).getByRole('button', { name: 'More actions for Scout' }))
    await second.user.click(await screen.findByRole('menuitem', { name: 'Unpin' }))
    await waitFor(() =>
      expect(within(sidebar()).queryByRole('region', { name: 'Pinned' })).toBeNull(),
    )
  })
})

describe('profile dialog', () => {
  it('saves a name and personal context and shows the name', async () => {
    const { user } = await renderApp('/approvals')
    await user.click(within(sidebar()).getByRole('button', { name: /Set your name/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Your profile' })
    const context = within(dialog).getByLabelText('Personal context') as HTMLTextAreaElement
    expect(context.getAttribute('placeholder')).toBe(
      "Anything you'd like your teammates to always know about you",
    )
    expect(context.rows).toBe(6)
    expect(within(dialog).getByText('0 / 2000')).toBeTruthy()
    await user.type(within(dialog).getByLabelText('Name'), 'Sam')
    await user.type(context, 'I run a bakery.')
    expect(within(dialog).getByText('15 / 2000')).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Your profile' })).toBeNull())
    expect(within(sidebar()).getByRole('button', { name: /Sam/ })).toBeTruthy()
    expect(JSON.parse(localStorage.getItem('mawl.profile') ?? '{}')).toEqual({
      name: 'Sam',
      context: 'I run a bakery.',
    })

    await user.click(within(sidebar()).getByRole('button', { name: /Sam/ }))
    const reopened = await screen.findByRole('dialog', { name: 'Your profile' })
    expect((within(reopened).getByLabelText('Name') as HTMLInputElement).value).toBe('Sam')
    expect((within(reopened).getByLabelText('Personal context') as HTMLTextAreaElement).value).toBe(
      'I run a bakery.',
    )
  })

  it('drops unsaved edits on Cancel', async () => {
    localStorage.setItem('mawl.profile', JSON.stringify({ name: 'Sam', context: '' }))
    const { user } = await renderApp('/approvals')
    await user.click(within(sidebar()).getByRole('button', { name: /Sam/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Your profile' })
    await user.type(within(dialog).getByLabelText('Name'), ' Jones')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Your profile' })).toBeNull())
    expect(within(sidebar()).getByRole('button', { name: /Sam/ }).textContent).not.toMatch(/Jones/)
  })
})
