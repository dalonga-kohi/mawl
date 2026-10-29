import { durSeconds } from '@mawl/ui'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MotionGlobalConfig } from 'motion/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { profile, thread } from '../test/fake-chat-api.ts'
import { fakeApi, renderApp, stubViewport } from '../test/render-app.tsx'
import { ApprovalsBadge, shouldCloseDrawer, sidebarMotion } from './Sidebar.tsx'

// The sidebar slides and fades out; under load the real animation clock can outlast a waitFor.
// Skipping Motion's animations makes the exit finish on the next frame, whatever the machine does.
beforeEach(() => {
  MotionGlobalConfig.skipAnimations = true
  stubViewport(1440)
})
afterEach(() => {
  MotionGlobalConfig.skipAnimations = false
  vi.restoreAllMocks()
})

const sweeper = () => profile({ name: 'Inbox Sweeper', slug: 'inbox-sweeper' })
const scout = () => profile({ name: 'Scout', slug: 'scout' })

const sidebar = () => screen.getByRole('complementary', { name: 'Sidebar' })
const follows = (a: Element, b: Element) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
const teammateLinks = () =>
  within(within(sidebar()).getByRole('region', { name: 'Teammates' })).getAllByRole('link')

describe('sidebar', () => {
  it('reads like a chat app: Search, Tools, Scheduled, Approvals, teammates, then the footer', async () => {
    const fake = fakeApi({ profiles: [sweeper()] })
    await renderApp('/t', fake.api)
    const bar = sidebar()
    // No wordmark or logo header, and no New chat button.
    expect(within(bar).queryByText('Mawl')).toBeNull()
    expect(within(bar).queryByRole('button', { name: 'New chat' })).toBeNull()
    const nav = within(bar).getByRole('navigation', { name: 'Main' })
    const labels = [...nav.querySelectorAll('a, button')].map((el) => el.textContent?.trim())
    expect(labels).toEqual(['Tools', 'Scheduled', 'Approvals'])
    const search = within(bar).getByRole('button', { name: /^Search/ })
    expect(follows(search, nav)).toBe(true)
    expect(within(nav).queryByText('Memory')).toBeNull()
    expect(within(nav).queryByText('Activity')).toBeNull()

    const teammates = within(bar).getByRole('region', { name: 'Teammates' })
    await within(teammates).findByRole('link', { name: /Inbox Sweeper/ })
    const account = within(bar).getByRole('button', { name: /Set your name/ })
    expect(follows(nav, teammates)).toBe(true)
    expect(follows(teammates, account)).toBe(true)
  })

  it('starts with a Search row that shows its shortcut and opens the command palette', async () => {
    const { user } = await renderApp('/t')
    const search = within(sidebar()).getByRole('button', { name: /^Search/ })
    expect(within(search).getByText(/^(Ctrl K|⌘K)$/).tagName).toBe('KBD')
    await user.click(search)
    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeTruthy()
  })

  it('has no icon rail or bottom tab bar', async () => {
    await renderApp('/t')
    expect(document.querySelector('[data-rail]')).toBeNull()
    expect(screen.getAllByRole('navigation')).toHaveLength(1)
    expect(screen.queryByRole('link', { name: 'Teammates' })).toBeNull()
  })

  it('marks the open view and carries the one sliding active indicator', async () => {
    await renderApp('/approvals')
    const nav = screen.getByRole('navigation', { name: 'Main' })
    const approvals = within(nav).getByRole('link', { name: 'Approvals' })
    expect(approvals.getAttribute('aria-current')).toBe('page')
    expect(within(nav).getByRole('link', { name: 'Tools' }).getAttribute('aria-current')).toBeNull()
    const indicators = sidebar().querySelectorAll('[data-active-indicator]')
    expect(indicators).toHaveLength(1)
    expect(approvals.contains(indicators[0] as Element)).toBe(true)
  })

  it('shapes rows as soft rounded rectangles with token fills, never pills or borders', async () => {
    await renderApp('/t')
    const tools = within(sidebar()).getByRole('link', { name: 'Tools' })
    expect(tools.className).toMatch(/(^|\s)rounded-md(\s|$)/)
    expect(tools.className).toContain('hover:bg-hover')
    expect(tools.className).toContain('active:scale-[.97]')
    expect(tools.className).not.toMatch(/(^|\s)border(\s|-)/)
  })

  it('ends with the owner: a round initial, the name, a menu chevron and a settings button', async () => {
    const { user, router } = await renderApp('/t')
    const account = within(sidebar()).getByRole('button', { name: /Set your name/ })
    const settings = within(sidebar()).getByRole('link', { name: 'Settings' })
    expect(account.parentElement).toBe(settings.parentElement)
    expect(settings.textContent?.trim()).toBe('')
    expect(account.getAttribute('aria-haspopup')).toBe('menu')

    await user.click(account)
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: 'Edit profile' })).toBeTruthy()
    expect(within(menu).getByRole('menuitem', { name: /Settings/ })).toBeTruthy()
    await user.keyboard('{Escape}')

    await user.click(within(sidebar()).getByRole('link', { name: 'Settings' }))
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

describe('approvals badge', () => {
  it('shows nothing while nothing waits', () => {
    const { container } = render(<ApprovalsBadge count={0} />)
    expect(container.textContent).toBe('')
  })

  it('shows the count, named for screen readers, and caps it at 99+', () => {
    const { rerender } = render(<ApprovalsBadge count={3} />)
    expect(screen.getByLabelText('3 waiting').textContent).toBe('3')
    rerender(<ApprovalsBadge count={140} />)
    expect(screen.getByLabelText('140 waiting').textContent).toBe('99+')
  })
})

describe('sidebar motion', () => {
  it('slides on a critically damped spring and reflows the view with it', () => {
    const m = sidebarMotion(false)
    expect(m.animate.width).toBeGreaterThan(0)
    expect(m.initial.width).toBe(0)
    const t = m.animate.transition as { damping: number; stiffness: number }
    expect(t.damping / (2 * Math.sqrt(t.stiffness))).toBeCloseTo(1, 1)
  })

  it('swaps the slide for a short fade under reduced motion', () => {
    const m = sidebarMotion(true)
    expect(m.initial).toEqual({ width: 280, opacity: 0 })
    expect(m.animate.transition).toEqual({ duration: durSeconds.base, width: { duration: 0 } })
    expect(m.exit.transition).toEqual({ duration: durSeconds.base * 0.7, width: { duration: 0 } })
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

  it('closes when swiped far enough left, or flicked left, and springs back otherwise', () => {
    expect(shouldCloseDrawer(-120, 0)).toBe(true)
    expect(shouldCloseDrawer(-20, -800)).toBe(true)
    expect(shouldCloseDrawer(-40, -100)).toBe(false)
    expect(shouldCloseDrawer(-150, 600)).toBe(false)
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
  })

  it('shows skeleton rows while loading', async () => {
    const fake = fakeApi({ profiles: [sweeper()] })
    fake.api.profiles.list = () => new Promise(() => {})
    await renderApp('/approvals', fake.api)
    const teammates = within(sidebar()).getByRole('region', { name: 'Teammates' })
    expect(teammates.getAttribute('aria-busy')).toBe('true')
    expect(within(teammates).queryAllByRole('link')).toHaveLength(0)
  })

  it('invites the first teammate when there are none, with one primary action', async () => {
    const { user } = await renderApp('/approvals')
    const teammates = within(sidebar()).getByRole('region', { name: 'Teammates' })
    expect(await within(teammates).findByText('No teammates yet')).toBeTruthy()
    const add = within(teammates).getAllByRole('button', { name: 'New teammate' })
    expect(add).toHaveLength(1)
    await user.click(add[0] as HTMLElement)
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

  it('ends the list with a New teammate row', async () => {
    const fake = fakeApi({ profiles: [sweeper(), scout()] })
    const { user } = await renderApp('/approvals', fake.api)
    const teammates = within(sidebar()).getByRole('region', { name: 'Teammates' })
    await within(teammates).findByRole('link', { name: /Scout/ })
    const add = within(teammates).getByRole('button', { name: 'New teammate' })
    for (const link of teammateLinks()) expect(follows(link, add)).toBe(true)
    await user.click(add)
    expect(await screen.findByRole('dialog', { name: 'New teammate' })).toBeTruthy()
  })

  it('marks the open teammate and moves the active indicator to it', async () => {
    const fake = fakeApi({ profiles: [sweeper(), scout()] })
    const { user, router } = await renderApp('/approvals', fake.api)
    const row = await within(sidebar()).findByRole('link', { name: /Scout/ })
    await user.click(row)
    await waitFor(() => expect(router.state.location.pathname).toBe('/t/scout'))
    const scoutRow = within(sidebar()).getByRole('link', { name: /Scout/ })
    expect(scoutRow.getAttribute('aria-current')).toBe('page')
    const indicators = sidebar().querySelectorAll('[data-active-indicator]')
    expect(indicators).toHaveLength(1)
    expect(scoutRow.contains(indicators[0] as Element)).toBe(true)
  })

  it('moves between teammates with the arrow keys, Home and End, and opens with Enter', async () => {
    const third = profile({ name: 'Quill', slug: 'quill' })
    const fake = fakeApi({ profiles: [sweeper(), scout(), third] })
    const { user, router } = await renderApp('/approvals', fake.api)
    await within(sidebar()).findByRole('link', { name: /Quill/ })
    const [a, b, c] = teammateLinks()
    a?.focus()
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(b)
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(document.activeElement).toBe(c)
    await user.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(b)
    await user.keyboard('{Home}')
    expect(document.activeElement).toBe(a)
    await user.keyboard('{End}')
    expect(document.activeElement).toBe(c)
    await user.keyboard('{Enter}')
    await waitFor(() => expect(router.state.location.pathname).toBe('/t/quill'))
  })

  it('pins a teammate to the top of the list with a pin mark, and remembers it', async () => {
    const fake = fakeApi({ profiles: [sweeper(), scout()] })
    const { user, unmount } = await renderApp('/approvals', fake.api)
    await within(sidebar()).findByRole('link', { name: /Scout/ })
    expect(teammateLinks()[0]?.textContent).toMatch(/Inbox Sweeper/)
    await user.click(within(sidebar()).getByRole('button', { name: 'More actions for Scout' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Pin' }))
    await waitFor(() => expect(teammateLinks()[0]?.textContent).toMatch(/Scout/))
    expect(
      within(teammateLinks()[0] as HTMLElement).getByRole('img', { name: 'Pinned' }),
    ).toBeTruthy()

    unmount()
    const second = await renderApp('/approvals', fake.api)
    await within(sidebar()).findByRole('link', { name: /Scout/ })
    expect(teammateLinks()[0]?.textContent).toMatch(/Scout/)

    // Unpin returns it to its place.
    await second.user.click(
      within(sidebar()).getByRole('button', { name: 'More actions for Scout' }),
    )
    await second.user.click(await screen.findByRole('menuitem', { name: 'Unpin' }))
    await waitFor(() => expect(teammateLinks()[0]?.textContent).toMatch(/Inbox Sweeper/))
    expect(within(sidebar()).queryByRole('img', { name: 'Pinned' })).toBeNull()
  })
})

describe('profile dialog', () => {
  const editProfile = async (user: Awaited<ReturnType<typeof renderApp>>['user'], name: RegExp) => {
    await user.click(within(sidebar()).getByRole('button', { name }))
    await user.click(await screen.findByRole('menuitem', { name: 'Edit profile' }))
    return screen.findByRole('dialog', { name: 'Your profile' })
  }

  it('saves a name and personal context and shows the name', async () => {
    const { user } = await renderApp('/approvals')
    const dialog = await editProfile(user, /Set your name/)
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

    const reopened = await editProfile(user, /Sam/)
    expect((within(reopened).getByLabelText('Name') as HTMLInputElement).value).toBe('Sam')
    expect((within(reopened).getByLabelText('Personal context') as HTMLTextAreaElement).value).toBe(
      'I run a bakery.',
    )
  })

  it('drops unsaved edits on Cancel', async () => {
    localStorage.setItem('mawl.profile', JSON.stringify({ name: 'Sam', context: '' }))
    const { user } = await renderApp('/approvals')
    const dialog = await editProfile(user, /Sam/)
    await user.type(within(dialog).getByLabelText('Name'), ' Jones')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Your profile' })).toBeNull())
    expect(within(sidebar()).getByRole('button', { name: /Sam/ }).textContent).not.toMatch(/Jones/)
  })
})
