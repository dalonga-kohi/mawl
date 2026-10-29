import type { ProfileId, Run, RunId, ThreadId } from '@mawl/contracts'
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSessionGreeting } from '../chat/greetings.ts'
import { approval, FakeRpcError } from '../test/fake-approvals-api.ts'
import { message, profile, thread } from '../test/fake-chat-api.ts'
import { fakeApi, renderApp, stubViewport } from '../test/render-app.tsx'

beforeEach(() => {
  stubViewport(1440)
  resetSessionGreeting()
  vi.spyOn(Math, 'random').mockReturnValue(0)
})
afterEach(() => vi.restoreAllMocks())

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString()

/** A chat whose newest run waits for approval, with one parked call. */
function waitingChat(status: Run['status'] = 'waiting_approval') {
  const p = profile({ name: 'Inbox Sweeper', slug: 'inbox-sweeper' })
  const t = thread(p.id)
  const runId = 'run_01JTESTAPPROVALCHAT000001' as RunId
  const parked = approval({ profileId: p.id, runId, expiresAt: inMinutes(30) })
  const other = approval({ profileId: p.id, tool: 'web_fetch' })
  const fake = fakeApi({ profiles: [p], approvals: [parked, other] })
  fake.chat.threads.push(t)
  fake.chat.runs.set(runId, {
    id: runId,
    profileId: p.id as ProfileId,
    threadId: t.id as ThreadId,
    trigger: 'user',
    status,
    budget: {},
    usage: { inputTokens: 0, outputTokens: 0 },
    segmentNo: 0,
    activeMs: 0,
    startedAt: null,
    endedAt: null,
    error: null,
  })
  fake.chat.messages.push(message(t.id, 'user', 'email Sam', { runId }))
  return { fake, parked, runId }
}

describe('approval card in the chat', () => {
  it('shows the parked call of a run that waits, with a link to the inbox', async () => {
    const { fake } = waitingChat()
    await renderApp('/t/inbox-sweeper', fake.api)
    const card = await screen.findByRole('article', { name: 'Send email for Inbox Sweeper' })
    expect(within(card).getByRole('button', { name: 'Approve' })).toBeTruthy()
    expect(within(card).getByRole('button', { name: 'Deny' })).toBeTruthy()
    expect(
      within(card).getByRole('link', { name: 'Open all approvals' }).getAttribute('href'),
    ).toBe('/approvals')
    // Only this run's approval, not the other run's.
    expect(screen.queryByRole('article', { name: 'Web fetch for Inbox Sweeper' })).toBeNull()
    // The run is parked, not thinking.
    expect(screen.queryByRole('status', { name: 'Inbox Sweeper is thinking' })).toBeNull()
  })

  it('approves with the right ids and keeps showing the result while the run continues', async () => {
    const { fake, parked, runId } = waitingChat()
    const { user } = await renderApp('/t/inbox-sweeper', fake.api)
    const card = await screen.findByRole('article', { name: 'Send email for Inbox Sweeper' })
    await user.click(within(card).getByRole('button', { name: 'Approve' }))
    await waitFor(() =>
      expect(fake.approvals.state.decided).toEqual([{ id: parked.id, decision: 'approve' }]),
    )
    await within(card).findByText('Approved')
    expect(within(card).queryByRole('button', { name: 'Approve' })).toBeNull()
    // The server resumes the run; the card stays with its result.
    await fake.server.running(runId)
    expect(
      within(
        await screen.findByRole('article', { name: 'Send email for Inbox Sweeper' }),
      ).getByText('Approved'),
    ).toBeTruthy()
  })

  it('denies', async () => {
    const { fake, parked } = waitingChat()
    const { user } = await renderApp('/t/inbox-sweeper', fake.api)
    const card = await screen.findByRole('article', { name: 'Send email for Inbox Sweeper' })
    await user.click(within(card).getByRole('button', { name: 'Deny' }))
    await waitFor(() =>
      expect(fake.approvals.state.decided).toEqual([{ id: parked.id, decision: 'deny' }]),
    )
    expect(await within(card).findByText('Denied')).toBeTruthy()
  })

  it('shows the true status when it was already decided elsewhere', async () => {
    const { fake, parked } = waitingChat()
    fake.approvals.state.decideError = new FakeRpcError('CONFLICT', { status: 'approved' })
    const { user } = await renderApp('/t/inbox-sweeper', fake.api)
    const card = await screen.findByRole('article', { name: 'Send email for Inbox Sweeper' })
    await user.click(within(card).getByRole('button', { name: 'Deny' }))
    expect(await within(card).findByText('Approved')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(parked.status).toBe('pending')
  })

  it('points to the inbox when the parked call cannot be loaded', async () => {
    const { fake } = waitingChat()
    fake.approvals.state.listError = new Error('down')
    await renderApp('/t/inbox-sweeper', fake.api)
    const note = await screen.findByText('Waiting for your OK. Open approvals to decide.')
    expect(note).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open approvals' }).getAttribute('href')).toBe(
      '/approvals',
    )
  })

  it('shows no card for a run that is not waiting', async () => {
    const { fake } = waitingChat('succeeded')
    await renderApp('/t/inbox-sweeper', fake.api)
    await screen.findByRole('region', { name: 'Chat with Inbox Sweeper' })
    await screen.findByText('email Sam')
    expect(screen.queryByRole('article', { name: 'Send email for Inbox Sweeper' })).toBeNull()
  })
})
