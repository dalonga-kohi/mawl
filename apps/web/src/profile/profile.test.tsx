import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { gate } from '../test/fake-user-api.ts'
import { fakeApi, renderApp, stubViewport } from '../test/render-app.tsx'
import { PROFILE_MIGRATED_KEY, PROFILE_STORAGE_KEY } from './profile-prefs.ts'

beforeEach(() => stubViewport(1440))

// `hidden`: an open modal dialog hides the sidebar from the accessibility tree.
const sidebar = () => screen.getByRole('complementary', { name: 'Sidebar', hidden: true })
const profileButton = (name: RegExp) =>
  within(sidebar()).findByRole('button', { name, hidden: true })
const cached = () => JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) ?? 'null')
const legacy = (name: string, context = '') =>
  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify({ name, context }))

async function openDialog(user: Awaited<ReturnType<typeof renderApp>>['user'], name: RegExp) {
  await user.click(await profileButton(name))
  return screen.findByRole('dialog', { name: 'Your profile' })
}

describe('owner profile, from the server', () => {
  it('shows the saved name and keeps it as the first-paint cache', async () => {
    const fake = fakeApi({ user: { name: 'Ada', personalContext: 'Runs a lab.' } })
    await renderApp('/approvals', fake.api)
    expect(await profileButton(/Ada/)).toBeTruthy()
    await waitFor(() => expect(cached()).toEqual({ name: 'Ada', context: 'Runs a lab.' }))
    expect(fake.user.updates).toEqual([])
  })

  it('paints the cached name at once, then follows the server', async () => {
    legacy('Sam')
    localStorage.setItem(PROFILE_MIGRATED_KEY, '1')
    const fake = fakeApi({ user: { name: 'Ada', personalContext: '' } })
    const held = gate()
    fake.user.getGate = held.promise
    await renderApp('/approvals', fake.api)
    expect(await profileButton(/Sam/)).toBeTruthy()
    held.open()
    expect(await profileButton(/Ada/)).toBeTruthy()
  })

  it('falls back to the cached name when the server cannot be reached', async () => {
    legacy('Sam')
    localStorage.setItem(PROFILE_MIGRATED_KEY, '1')
    const fake = fakeApi()
    fake.user.getError = new Error('Failed to fetch')
    await renderApp('/approvals', fake.api)
    await waitFor(() => expect(fake.user.gets).toBeGreaterThan(0))
    expect(await profileButton(/Sam/)).toBeTruthy()
  })
})

describe('owner profile, one-time move from this browser', () => {
  it('pushes a browser-only profile up once when the server has none', async () => {
    legacy('Sam', 'I run a bakery.')
    const fake = fakeApi()
    const first = await renderApp('/approvals', fake.api)
    await waitFor(() =>
      expect(fake.user.updates).toEqual([{ name: 'Sam', personalContext: 'I run a bakery.' }]),
    )
    expect(await profileButton(/Sam/)).toBeTruthy()
    expect(localStorage.getItem(PROFILE_MIGRATED_KEY)).toBe('1')
    first.unmount()

    // The owner later clears the profile elsewhere: this browser must not push its copy again.
    fake.user.profile = { name: '', personalContext: '' }
    legacy('Sam', 'I run a bakery.')
    await renderApp('/approvals', fake.api)
    expect(await profileButton(/Set your name/)).toBeTruthy()
    expect(fake.user.updates).toHaveLength(1)
  })

  it('keeps the server profile when both exist, and replaces the stale copy', async () => {
    legacy('Sam')
    const fake = fakeApi({ user: { name: 'Ada', personalContext: '' } })
    await renderApp('/approvals', fake.api)
    expect(await profileButton(/Ada/)).toBeTruthy()
    await waitFor(() => expect(cached()).toEqual({ name: 'Ada', context: '' }))
    expect(fake.user.updates).toEqual([])
    expect(localStorage.getItem(PROFILE_MIGRATED_KEY)).toBe('1')
  })

  it('keeps the browser copy and tries again next time when the move fails', async () => {
    legacy('Sam')
    const fake = fakeApi()
    fake.user.updateError = new Error('Failed to fetch')
    await renderApp('/approvals', fake.api)
    await waitFor(() => expect(fake.user.gets).toBeGreaterThan(0))
    expect(await profileButton(/Sam/)).toBeTruthy()
    expect(localStorage.getItem(PROFILE_MIGRATED_KEY)).toBeNull()
    expect(cached()).toEqual({ name: 'Sam', context: '' })
  })
})

describe('profile dialog, saving', () => {
  it('shows the save in flight, the new name at once, and closes when the server confirms', async () => {
    const fake = fakeApi()
    const held = gate()
    fake.user.updateGate = held.promise
    const { user } = await renderApp('/approvals', fake.api)
    const dialog = await openDialog(user, /Set your name/)
    await user.type(within(dialog).getByLabelText('Name'), 'Sam')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    const saving = within(dialog).getByRole('button', { name: 'Saving…' })
    expect(saving.hasAttribute('disabled')).toBe(true)
    // Optimistic: the sidebar already shows the new name.
    expect(await profileButton(/Sam/)).toBeTruthy()
    held.open()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Your profile' })).toBeNull())
    expect(fake.user.profile).toEqual({ name: 'Sam', personalContext: '' })
  })

  it('rolls back, says so and keeps the edits when the save fails', async () => {
    const fake = fakeApi({ user: { name: 'Ada', personalContext: '' } })
    fake.user.updateError = new Error('Failed to fetch')
    const { user } = await renderApp('/approvals', fake.api)
    const dialog = await openDialog(user, /Ada/)
    const name = within(dialog).getByLabelText('Name') as HTMLInputElement
    await user.clear(name)
    await user.type(name, 'Sam')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(
      await screen.findByText("Couldn't save your profile. Check that the Mawl server is running."),
    ).toBeTruthy()
    expect(await profileButton(/Ada/)).toBeTruthy()
    expect(screen.getByRole('dialog', { name: 'Your profile' })).toBeTruthy()
    expect(name.value).toBe('Sam')
    expect(within(dialog).getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(
      false,
    )
  })

  it('marks a name that is too long next to the field and does not save it', async () => {
    const fake = fakeApi()
    const { user } = await renderApp('/approvals', fake.api)
    const dialog = await openDialog(user, /Set your name/)
    const name = within(dialog).getByLabelText('Name')
    fireEvent.change(name, { target: { value: 'x'.repeat(81) } })
    expect(name.getAttribute('aria-invalid')).toBe('true')
    expect(within(dialog).getByText('Keep your name to 80 characters.')).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(fake.user.updates).toEqual([])
    expect(screen.getByRole('dialog', { name: 'Your profile' })).toBeTruthy()
  })

  it('counts the personal context live and flags it past 2000 characters', async () => {
    const fake = fakeApi()
    const { user } = await renderApp('/approvals', fake.api)
    const dialog = await openDialog(user, /Set your name/)
    const context = within(dialog).getByLabelText('Personal context')
    fireEvent.change(context, { target: { value: 'x'.repeat(2001) } })
    expect(within(dialog).getByText('2001 / 2000')).toBeTruthy()
    expect(context.getAttribute('aria-invalid')).toBe('true')
    expect(within(dialog).getByText('Trim it by 1 character.')).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(fake.user.updates).toEqual([])
  })

  it('discards edits on Escape', async () => {
    const fake = fakeApi({ user: { name: 'Ada', personalContext: '' } })
    const { user } = await renderApp('/approvals', fake.api)
    const dialog = await openDialog(user, /Ada/)
    await user.type(within(dialog).getByLabelText('Name'), ' Jones')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Your profile' })).toBeNull())
    expect((await profileButton(/Ada/)).textContent).not.toMatch(/Jones/)
    expect(fake.user.updates).toEqual([])
    const reopened = await openDialog(user, /Ada/)
    expect((within(reopened).getByLabelText('Name') as HTMLInputElement).value).toBe('Ada')
  })
})
