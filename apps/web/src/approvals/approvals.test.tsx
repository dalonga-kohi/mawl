import type { Approval } from '@mawl/contracts'
import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { approval, FakeRpcError } from '../test/fake-approvals-api.ts'
import { profile } from '../test/fake-chat-api.ts'
import { fakeApi, renderApp, stubViewport } from '../test/render-app.tsx'
import { expiryLabel } from './format.ts'

beforeEach(() => stubViewport(1440))

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString()

const sweeper = profile({ name: 'Inbox Sweeper', slug: 'inbox-sweeper' })

function setup(items: Approval[]) {
  const fake = fakeApi({ profiles: [sweeper], approvals: items })
  return fake
}

const pendingRow = (name = 'Send email for Inbox Sweeper') => screen.findByRole('article', { name })

describe('expiryLabel', () => {
  const now = Date.parse('2026-10-18T10:00:00.000Z')
  const at = (ms: number) => new Date(now + ms).toISOString()
  it('counts down in the largest sensible unit', () => {
    expect(expiryLabel(at(30 * 60_000), now)).toBe('Expires in 30 min')
    expect(expiryLabel(at(29.2 * 60_000), now)).toBe('Expires in 30 min')
    expect(expiryLabel(at(20_000), now)).toBe('Expires in under a minute')
    expect(expiryLabel(at(3 * 3_600_000), now)).toBe('Expires in 3 h')
    expect(expiryLabel(at(2 * 86_400_000), now)).toBe('Expires in 2 d')
  })
  it('says so when the time is up but the sweep has not run yet', () => {
    expect(expiryLabel(at(-5_000), now)).toBe('Expiring now')
  })
})

describe('approvals inbox', () => {
  it('shows a skeleton while loading', async () => {
    const fake = setup([])
    let open = () => {}
    fake.approvals.state.listGate = new Promise<void>((r) => {
      open = r
    })
    await renderApp('/approvals', fake.api)
    expect(await screen.findByRole('status', { name: 'Loading approvals' })).toBeTruthy()
    open()
    expect(
      await screen.findByRole('heading', { level: 2, name: "You're all caught up" }),
    ).toBeTruthy()
  })

  it('shows the all caught up state when nothing waits', async () => {
    await renderApp('/approvals', setup([]).api)
    expect(
      await screen.findByRole('heading', { level: 2, name: "You're all caught up" }),
    ).toBeTruthy()
  })

  it('shows what a pending approval is about, with the redacted args', async () => {
    const a = approval({
      profileId: sweeper.id,
      expiresAt: inMinutes(30),
      argsRedacted: { to: '[redacted]', subject: 'Lunch?' },
    })
    await renderApp('/approvals', setup([a]).api)
    const row = await pendingRow()
    expect(within(row).getByText('Inbox Sweeper')).toBeTruthy()
    expect(within(row).getByText('Send a message')).toBeTruthy()
    expect(
      within(row).getByText('Sending a message to someone outside Mawl needs your OK.'),
    ).toBeTruthy()
    const args = within(row).getByLabelText('Arguments')
    expect(args.textContent).toContain('"subject": "Lunch?"')
    expect(args.textContent).toContain('[redacted]')
    expect(within(row).getByText('Expires in 30 min')).toBeTruthy()
    expect(within(row).getByRole('button', { name: 'Approve' })).toBeTruthy()
    expect(within(row).getByRole('button', { name: 'Deny' })).toBeTruthy()
  })

  it('lists pending first, then resolved ones with their status', async () => {
    const items = [
      approval({ profileId: sweeper.id, expiresAt: inMinutes(10) }),
      approval({
        profileId: sweeper.id,
        tool: 'web_fetch',
        status: 'approved',
        decidedAt: '2026-10-18T09:00:00.000Z',
      }),
      approval({
        profileId: sweeper.id,
        tool: 'run_shell',
        status: 'denied',
        decidedAt: '2026-10-18T09:01:00.000Z',
      }),
      approval({
        profileId: sweeper.id,
        tool: 'post_tweet',
        status: 'expired',
        decidedAt: '2026-10-18T09:02:00.000Z',
      }),
      approval({
        profileId: sweeper.id,
        tool: 'delete_file',
        status: 'cancelled',
        decidedAt: '2026-10-18T09:03:00.000Z',
      }),
    ]
    await renderApp('/approvals', setup(items).api)
    await pendingRow()
    const recent = screen.getByRole('region', { name: 'Recent' })
    expect(
      within(recent).getByRole('article', { name: 'Web fetch for Inbox Sweeper' }),
    ).toBeTruthy()
    for (const label of ['Approved', 'Denied', 'Expired', 'Cancelled']) {
      expect(within(recent).getByText(label)).toBeTruthy()
    }
    expect(within(recent).queryByRole('button', { name: 'Approve' })).toBeNull()
    const waiting = screen.getByRole('region', { name: 'Waiting for you' })
    expect(within(waiting).getAllByRole('article')).toHaveLength(1)
  })

  it('approves with the right id and shows the result', async () => {
    const a = approval({ profileId: sweeper.id, expiresAt: inMinutes(30) })
    const fake = setup([a])
    const { user } = await renderApp('/approvals', fake.api)
    const row = await pendingRow()
    await user.click(within(row).getByRole('button', { name: 'Approve' }))
    await waitFor(() =>
      expect(fake.approvals.state.decided).toEqual([{ id: a.id, decision: 'approve' }]),
    )
    const recent = await screen.findByRole('region', { name: 'Recent' })
    expect(await within(recent).findByText('Approved')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Waiting for you' })).toBeNull()
  })

  it('denies with the right id', async () => {
    const a = approval({ profileId: sweeper.id, expiresAt: inMinutes(30) })
    const fake = setup([a])
    const { user } = await renderApp('/approvals', fake.api)
    const row = await pendingRow()
    await user.click(within(row).getByRole('button', { name: 'Deny' }))
    await waitFor(() =>
      expect(fake.approvals.state.decided).toEqual([{ id: a.id, decision: 'deny' }]),
    )
    expect(await screen.findByText('Denied')).toBeTruthy()
  })

  it('disables both buttons while a decision is in flight', async () => {
    const a = approval({ profileId: sweeper.id, expiresAt: inMinutes(30) })
    const fake = setup([a])
    let open = () => {}
    fake.approvals.state.decideGate = new Promise<void>((r) => {
      open = r
    })
    const { user } = await renderApp('/approvals', fake.api)
    const row = await pendingRow()
    await user.click(within(row).getByRole('button', { name: 'Approve' }))
    await waitFor(() => {
      expect(within(row).getByRole('button', { name: 'Approve' }).hasAttribute('disabled')).toBe(
        true,
      )
      expect(within(row).getByRole('button', { name: 'Deny' }).hasAttribute('disabled')).toBe(true)
    })
    open()
    expect(await screen.findByText('Approved')).toBeTruthy()
    expect(fake.approvals.state.decided).toHaveLength(1)
  })

  it('shows the true status on a conflict, without an error', async () => {
    const a = approval({ profileId: sweeper.id, expiresAt: inMinutes(30) })
    const fake = setup([a])
    // The server expired it before the click arrived.
    fake.approvals.state.decideError = new FakeRpcError('CONFLICT', { status: 'expired' })
    const { user } = await renderApp('/approvals', fake.api)
    const row = await pendingRow()
    fake.approvals.state.items[0] = { ...a, status: 'expired', decidedAt: inMinutes(0) }
    await user.click(within(row).getByRole('button', { name: 'Approve' }))
    const recent = await screen.findByRole('region', { name: 'Recent' })
    expect(await within(recent).findByText('Expired')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says so and keeps the buttons when the decision could not be sent', async () => {
    const a = approval({ profileId: sweeper.id, expiresAt: inMinutes(30) })
    const fake = setup([a])
    fake.approvals.state.decideError = new Error('offline')
    const { user } = await renderApp('/approvals', fake.api)
    const row = await pendingRow()
    await user.click(within(row).getByRole('button', { name: 'Approve' }))
    expect((await within(row).findByRole('alert')).textContent).toContain("couldn't save")
    expect(within(row).getByRole('button', { name: 'Approve' }).hasAttribute('disabled')).toBe(
      false,
    )
  })

  it('shows an error with a retry when the list cannot load', async () => {
    const fake = setup([approval({ profileId: sweeper.id, expiresAt: inMinutes(30) })])
    fake.approvals.state.listError = new Error('down')
    const { user } = await renderApp('/approvals', fake.api)
    expect(
      await screen.findByRole('heading', { level: 2, name: "Can't load approvals" }),
    ).toBeTruthy()
    fake.approvals.state.listError = null
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await pendingRow()).toBeTruthy()
  })

  it('falls back to a plain name for an unknown teammate', async () => {
    const a = approval({ expiresAt: inMinutes(30) })
    await renderApp('/approvals', setup([a]).api)
    expect(await screen.findByRole('article', { name: 'Send email for A teammate' })).toBeTruthy()
  })
})

describe('approvals badge in the sidebar', () => {
  it('shows how many wait, and nothing when none do', async () => {
    const items = [
      approval({ profileId: sweeper.id, expiresAt: inMinutes(30) }),
      approval({ profileId: sweeper.id, expiresAt: inMinutes(30) }),
      approval({ profileId: sweeper.id, status: 'approved' }),
    ]
    await renderApp('/t', setup(items).api)
    expect((await screen.findByLabelText('2 waiting')).textContent).toBe('2')
  })

  it('shows no badge when nothing waits', async () => {
    await renderApp('/t', setup([]).api)
    await screen.findByRole('link', { name: 'Approvals' })
    expect(screen.queryByLabelText(/waiting$/)).toBeNull()
  })

  it('follows a new approval that arrives over the event stream', async () => {
    const fake = setup([])
    await renderApp('/t', fake.api)
    await screen.findByRole('link', { name: 'Approvals' })
    fake.approvals.state.items.push(approval({ profileId: sweeper.id, expiresAt: inMinutes(30) }))
    await fake.approvals.server(fake.approvals.state.items[0]?.id as never, {})
    expect((await screen.findByLabelText('1 waiting')).textContent).toBe('1')
  })
})
