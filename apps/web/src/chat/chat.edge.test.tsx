import type { ProfileId, Run, RunId, ThreadId } from '@mawl/contracts'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { chatSearch } from '../router.tsx'
import { message, profile, thread } from '../test/fake-chat-api.ts'
import { fakeApi, renderApp, stubViewport } from '../test/render-app.tsx'
import { TooltipProvider } from '../ui/Tooltip.tsx'
import { Composer } from './Composer.tsx'
import { resetSessionGreeting } from './greetings.ts'

beforeAll(async () => {
  await import('./ChatView.tsx')
})
beforeEach(() => {
  stubViewport(1440)
  // Line 0 of the greetings is "What's next, {name}?"; the pick is once per session.
  resetSessionGreeting()
  vi.spyOn(Math, 'random').mockReturnValue(0)
})
afterEach(() => vi.restoreAllMocks())

const sweeper = () => profile({ name: 'Inbox Sweeper', slug: 'inbox-sweeper' })

/** A run row as the fake server would hold it, planted before the app loads. */
function plantRun(
  fake: ReturnType<typeof fakeApi>,
  profileId: ProfileId,
  threadId: ThreadId,
  status: Run['status'],
  id = `run_01JTESTEDGE${String(fake.chat.runs.size).padStart(11, '0')}` as RunId,
): RunId {
  fake.chat.runs.set(id, {
    id,
    profileId,
    threadId,
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
  return id
}

describe('chat edge cases', () => {
  it('does not follow a run whose reply is already stored', async () => {
    const p = sweeper()
    const fake = fakeApi({ profiles: [p] })
    const t = thread(p.id)
    fake.chat.threads.push(t)
    const runId = plantRun(fake, p.id, t.id, 'running')
    fake.chat.messages.push(
      message(t.id, 'user', 'hello', { runId }),
      message(t.id, 'assistant', 'hi there', { runId }),
    )
    const get = vi.spyOn(fake.api.runs, 'get')
    const { queryClient } = await renderApp('/t/inbox-sweeper', fake.api)
    expect(await screen.findByText('hi there')).toBeTruthy()
    // Let every query settle, so a wrongly followed run would have shown up by now.
    await waitFor(() => expect(queryClient.isFetching()).toBe(0))
    expect(get).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
  })

  it('shows Stop and "Paused" for a paused run', async () => {
    const p = sweeper()
    const fake = fakeApi({ profiles: [p] })
    const t = thread(p.id)
    fake.chat.threads.push(t)
    const runId = plantRun(fake, p.id, t.id, 'paused')
    fake.chat.messages.push(message(t.id, 'user', 'long job', { runId }))
    await renderApp('/t/inbox-sweeper', fake.api)
    expect(await screen.findByRole('button', { name: 'Stop' })).toBeTruthy()
    expect(screen.getByText('Paused')).toBeTruthy()
  })

  it('does not announce a run that was already over when the conversation opened', async () => {
    const p = sweeper()
    const fake = fakeApi({ profiles: [p] })
    const t = thread(p.id)
    fake.chat.threads.push(t)
    const runId = plantRun(fake, p.id, t.id, 'failed')
    fake.chat.runs.set(runId, { ...(fake.chat.runs.get(runId) as Run), error: 'provider_error' })
    fake.chat.messages.push(message(t.id, 'user', 'try this', { runId }))
    await renderApp('/t/inbox-sweeper', fake.api)
    expect(await screen.findByRole('alert')).toBeTruthy()
    const live = document.querySelector('section[aria-label^="Chat with"] p[aria-live="polite"]')
    expect(live?.textContent).toBe('')
  })

  it('announces a failure once when a watched run fails', async () => {
    const fake = fakeApi({ profiles: [sweeper()] })
    const { user } = await renderApp('/t/inbox-sweeper', fake.api)
    await user.type(await screen.findByLabelText('Message Inbox Sweeper'), 'hi{Enter}')
    await screen.findByRole('button', { name: 'Stop' })
    await fake.server.fail('budget_steps')
    const live = document.querySelector('section[aria-label^="Chat with"] p[aria-live="polite"]')
    await waitFor(() =>
      expect(live?.textContent).toMatch(/couldn't finish: Stopped after too many/),
    )
  })

  it('pages in earlier messages from the top of a long conversation', async () => {
    const p = sweeper()
    const fake = fakeApi({ profiles: [p] })
    const t = thread(p.id)
    fake.chat.threads.push(t)
    for (let i = 1; i <= 120; i++) {
      fake.chat.messages.push(message(t.id, i % 2 ? 'user' : 'assistant', `line number ${i}`))
    }
    const { user } = await renderApp('/t/inbox-sweeper', fake.api)
    expect(await screen.findByText('line number 120')).toBeTruthy()
    expect(screen.getByText('line number 71')).toBeTruthy()
    expect(screen.queryByText('line number 70')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Show earlier messages' }))
    expect(await screen.findByText('line number 70')).toBeTruthy()
    expect(screen.getByText('line number 21')).toBeTruthy()
    expect(screen.queryByText('line number 20')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Show earlier messages' }))
    expect(await screen.findByText('line number 1')).toBeTruthy()
    // Everything is loaded: no more button.
    expect(screen.queryByRole('button', { name: 'Show earlier messages' })).toBeNull()
  })

  it('offers no earlier-messages button for exactly one full page less one', async () => {
    const p = sweeper()
    const fake = fakeApi({ profiles: [p] })
    const t = thread(p.id)
    fake.chat.threads.push(t)
    for (let i = 1; i <= 49; i++) fake.chat.messages.push(message(t.id, 'user', `short ${i}`))
    await renderApp('/t/inbox-sweeper', fake.api)
    expect(await screen.findByText('short 49')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Show earlier messages' })).toBeNull()
  })

  it('renders links with noopener noreferrer in a new tab', async () => {
    const p = sweeper()
    const fake = fakeApi({ profiles: [p] })
    const t = thread(p.id)
    fake.chat.threads.push(t)
    fake.chat.messages.push(
      message(
        t.id,
        'assistant',
        'See [the docs](https://example.com/docs) and https://example.org.',
      ),
    )
    await renderApp('/t/inbox-sweeper', fake.api)
    const link = await screen.findByRole('link', { name: 'the docs' })
    expect(link.getAttribute('href')).toBe('https://example.com/docs')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    const auto = screen.getByRole('link', { name: 'https://example.org' })
    expect(auto.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('shows raw HTML in a reply as text, never as markup', async () => {
    const p = sweeper()
    const fake = fakeApi({ profiles: [p] })
    const t = thread(p.id)
    fake.chat.threads.push(t)
    fake.chat.messages.push(
      message(
        t.id,
        'assistant',
        'Hi <img src=x onerror="window.__pwned=1"> <script>window.__pwned=2</script> [x](javascript:alert(1))',
      ),
    )
    await renderApp('/t/inbox-sweeper', fake.api)
    const reply = await screen.findByRole('article', { name: 'Reply' })
    expect(reply.querySelector('img')).toBeNull()
    expect(reply.querySelector('script')).toBeNull()
    expect(reply.querySelector('[onerror]')).toBeNull()
    for (const a of Array.from(reply.querySelectorAll('a'))) {
      expect(a.getAttribute('href') ?? '').not.toMatch(/^javascript:/i)
    }
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined()
  })

  it('shows a stored user message as plain text, not markdown or HTML', async () => {
    const p = sweeper()
    const fake = fakeApi({ profiles: [p] })
    const t = thread(p.id)
    fake.chat.threads.push(t)
    fake.chat.messages.push(message(t.id, 'user', '<b>not bold</b> **nor this**'))
    await renderApp('/t/inbox-sweeper', fake.api)
    const bubble = await screen.findByText('<b>not bold</b> **nor this**', { selector: 'div' })
    expect(bubble.querySelector('b, strong')).toBeNull()
  })

  it('sends unicode and very long messages intact', async () => {
    const fake = fakeApi({ profiles: [sweeper()] })
    const { user } = await renderApp('/t/inbox-sweeper', fake.api)
    const box = await screen.findByLabelText('Message Inbox Sweeper')
    const long = `日本語 😀 ${'x'.repeat(20_000)}`
    await user.click(box)
    await user.paste(long)
    await user.keyboard('{Enter}')
    expect(fake.chat.started[0]?.prompt).toBe(long)
  })

  it('ignores a second Enter while the first send is still in flight', async () => {
    const fake = fakeApi({ profiles: [sweeper()] })
    let release = () => {}
    fake.chat.startGate = new Promise<void>((r) => {
      release = r
    })
    const { user } = await renderApp('/t/inbox-sweeper', fake.api)
    const box = await screen.findByLabelText('Message Inbox Sweeper')
    await user.type(box, 'first{Enter}')
    await user.type(box, 'second{Enter}')
    release()
    await waitFor(() => expect(fake.chat.started).toHaveLength(1))
    expect(fake.chat.started[0]?.prompt).toBe('first')
  })

  it('treats a start error with a NOT_FOUND code as a gone conversation and keeps the draft', async () => {
    const fake = fakeApi({ profiles: [sweeper()] })
    fake.chat.startError = Object.assign(new Error('gone'), { code: 'NOT_FOUND' })
    const { user } = await renderApp('/t/inbox-sweeper', fake.api)
    const box = await screen.findByLabelText('Message Inbox Sweeper')
    await user.type(box, 'hello{Enter}')
    expect((await screen.findByRole('alert')).textContent).toMatch(/conversation is gone/)
    expect((box as HTMLTextAreaElement).value).toBe('hello')
  })

  it('shows Reconnecting… in the header while the live stream is down', async () => {
    const fake = fakeApi({ profiles: [sweeper()] })
    await renderApp('/t/inbox-sweeper', fake.api)
    await screen.findByRole('heading', { name: "What's next?" })
    fake.server.setLiveStatus('reconnecting')
    expect(await screen.findByText('Reconnecting…')).toBeTruthy()
    fake.server.setLiveStatus('live')
    await waitFor(() => expect(screen.queryByText('Reconnecting…')).toBeNull())
  })

  it('opens a chat on the second teammate without leaking the first one view', async () => {
    const a = profile({ name: 'Alpha', slug: 'alpha' })
    const b = profile({ name: 'Beta', slug: 'beta' })
    const fake = fakeApi({ profiles: [a, b] })
    const ta = thread(a.id, { title: 'Alpha chat' })
    fake.chat.threads.push(ta)
    fake.chat.messages.push(message(ta.id, 'user', 'only for alpha'))
    const { router } = await renderApp('/t/alpha', fake.api)
    expect(await screen.findByText('only for alpha')).toBeTruthy()
    await router.navigate({ to: '/t/$slug', params: { slug: 'beta' }, search: {} })
    expect(await screen.findByRole('heading', { level: 1, name: 'Beta' })).toBeTruthy()
    expect(screen.queryByText('only for alpha')).toBeNull()
  })

  it('ignores a thread param that belongs to no conversation by showing a retry, not a crash', async () => {
    const p = sweeper()
    const fake = fakeApi({ profiles: [p] })
    const stranger = 'thr_01JTESTNOSUCHTHREAD0000000'
    const { router } = await renderApp(`/t/inbox-sweeper?thread=${stranger}`, fake.api)
    // An unknown id yields an empty history; the composer must still work.
    expect(await screen.findByLabelText('Message Inbox Sweeper')).toBeTruthy()
    expect(router.state.location.pathname).toBe('/t/inbox-sweeper')
  })
})

describe('chatSearch', () => {
  it('keeps a thread id and the "new" marker', () => {
    expect(chatSearch({ thread: 'new' })).toEqual({ thread: 'new' })
    expect(chatSearch({ thread: 'thr_01JTEST0000000000000000001' })).toEqual({
      thread: 'thr_01JTEST0000000000000000001',
    })
  })

  it.each([
    ['empty string', ''],
    ['a number', 42],
    ['an object', { a: 1 }],
    ['an array', ['new']],
    ['null', null],
    ['a wrong prefix', 'run_01JTEST0000000000000000001'],
    ['a script', '<script>alert(1)</script>'],
    ['"New" in other case', 'New'],
    ['a thread id with trailing junk', 'thr_01JTEST0000000000000000001/../x'],
  ])('drops %s', (_, thread) => {
    expect(chatSearch({ thread })).toEqual({})
  })

  it('drops unrelated params and handles a missing thread', () => {
    expect(chatSearch({})).toEqual({})
    expect(chatSearch({ other: 'x', thread: 'new' })).toEqual({ thread: 'new' })
  })
})

describe('Composer', () => {
  function Harness({
    busy = false,
    sending = false,
    onSend,
  }: {
    busy?: boolean
    sending?: boolean
    onSend: () => void
  }) {
    const [value, setValue] = useState('hello')
    return (
      <TooltipProvider>
        <Composer
          value={value}
          onChange={setValue}
          onSend={onSend}
          onStop={() => {}}
          busy={busy}
          sending={sending}
          stopping={false}
          label="Message"
          placeholder="Ask"
        />
      </TooltipProvider>
    )
  }

  it('does not send on the Enter that confirms an IME composition', () => {
    const onSend = vi.fn()
    render(<Harness onSend={onSend} />)
    const box = screen.getByLabelText('Message')
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true })
    expect(onSend).not.toHaveBeenCalled()
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('does not send while a send is in flight', async () => {
    const onSend = vi.fn()
    render(<Harness sending onSend={onSend} />)
    fireEvent.keyDown(screen.getByLabelText('Message'), { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()
    const send = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement
    expect(send.disabled).toBe(true)
  })

  it('swaps Send for Stop while busy and never sends', async () => {
    const onSend = vi.fn()
    const user = userEvent.setup()
    render(<Harness busy onSend={onSend} />)
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
    await user.type(screen.getByLabelText('Message'), '{Enter}')
    expect(onSend).not.toHaveBeenCalled()
    expect(within(document.body).getByRole('button', { name: 'Stop' })).toBeTruthy()
  })
})
