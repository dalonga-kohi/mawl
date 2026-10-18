import type { ThreadId } from '@faire/contracts'
import { screen, waitFor, within } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { message, profile, thread } from '../test/fake-chat-api.ts'
import { credential } from '../test/fake-providers-api.ts'
import { fakeApi, renderApp, stubViewport } from '../test/render-app.tsx'

// The conversation is a lazy route chunk; load it once so the first test isn't timing its import.
beforeAll(async () => {
  await import('./ChatView.tsx')
})
beforeEach(() => stubViewport(1440))

const sweeper = () => profile({ name: 'Inbox Sweeper', slug: 'inbox-sweeper' })

function railMascot() {
  return document.querySelector('nav[aria-label="Main"] .beaver')?.getAttribute('data-state')
}

describe('teammates landing', () => {
  it('opens the first teammate on wide screens', async () => {
    const fake = fakeApi({ profiles: [sweeper()] })
    const { router } = await renderApp('/t', fake.api)
    await waitFor(() => expect(router.state.location.pathname).toBe('/t/inbox-sweeper'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Inbox Sweeper' })).toBeTruthy()
  })

  it('lists teammates full screen on phones', async () => {
    stubViewport(390)
    const fake = fakeApi({ profiles: [sweeper()] })
    const { router } = await renderApp('/t', fake.api)
    const list = await screen.findByRole('complementary', { name: 'Teammates' })
    expect(await within(list).findByRole('link', { name: /Inbox Sweeper/ })).toBeTruthy()
    expect(router.state.location.pathname).toBe('/t')
  })

  it('creates a first teammate once a model is connected', async () => {
    const cred = credential({ provider: 'anthropic', label: 'Anthropic' })
    const fake = fakeApi({ credentials: [cred] })
    const { user, router } = await renderApp('/t', fake.api)
    await user.click(await screen.findByRole('button', { name: 'Create a teammate' }))
    const dialog = await screen.findByRole('dialog', { name: 'New teammate' })
    await user.type(within(dialog).getByLabelText('Name'), 'Inbox Sweeper')
    expect((within(dialog).getByLabelText('Model') as HTMLInputElement).value).toBe(
      'claude-sonnet-5-5',
    )
    await user.type(within(dialog).getByLabelText('Job (optional)'), 'Keep my inbox tidy.')
    await user.click(within(dialog).getByRole('button', { name: 'Create teammate' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/t/inbox-sweeper'))
    expect(fake.chat.created).toEqual([
      {
        name: 'Inbox Sweeper',
        modelMain: `${cred.id}:claude-sonnet-5-5`,
        personaMd: 'Keep my inbox tidy.',
      },
    ])
  })

  it('asks for a name and a model before creating', async () => {
    const fake = fakeApi({ credentials: [credential({ provider: 'openai', label: 'OpenAI' })] })
    const { user } = await renderApp('/t', fake.api)
    await user.click(await screen.findByRole('button', { name: 'Create a teammate' }))
    const dialog = await screen.findByRole('dialog', { name: 'New teammate' })
    await user.click(within(dialog).getByRole('button', { name: 'Create teammate' }))
    expect(within(dialog).getByText('Give your teammate a name.')).toBeTruthy()
    expect(within(dialog).getByText('Enter the model id your provider uses.')).toBeTruthy()
    expect(document.activeElement).toBe(within(dialog).getByLabelText('Name'))
    expect(fake.chat.created).toEqual([])
  })

  it('says when the chosen connection disappeared', async () => {
    const fake = fakeApi({ credentials: [credential({ provider: 'anthropic' })] })
    fake.chat.createError = Object.assign(new Error('x'), { code: 'UNKNOWN_CREDENTIAL' })
    const { user } = await renderApp('/t', fake.api)
    await user.click(await screen.findByRole('button', { name: 'Create a teammate' }))
    const dialog = await screen.findByRole('dialog', { name: 'New teammate' })
    await user.type(within(dialog).getByLabelText('Name'), 'Scout')
    await user.click(within(dialog).getByRole('button', { name: 'Create teammate' }))
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/connection was removed/)
  })

  it('points to model settings from the new teammate button when nothing is connected', async () => {
    const { user } = await renderApp('/t')
    await user.click(screen.getByRole('button', { name: 'New teammate' }))
    const dialog = await screen.findByRole('dialog', { name: 'New teammate' })
    expect(within(dialog).getByRole('link', { name: 'Connect a model' })).toBeTruthy()
  })
})

describe('chat', () => {
  it('sends a message and streams the reply until it is stored', async () => {
    const fake = fakeApi({ profiles: [sweeper()] })
    const { user, router } = await renderApp('/t/inbox-sweeper', fake.api)
    expect(await screen.findByRole('heading', { name: 'Ask Inbox Sweeper anything' })).toBeTruthy()

    const box = screen.getByLabelText('Message Inbox Sweeper')
    await user.type(box, 'Say hello{Enter}')
    expect(fake.chat.started).toEqual([
      { profileId: fake.chat.profiles[0]?.id, prompt: 'Say hello' },
    ])
    // The bubble (the thread menu also shows it, as the new chat's title).
    expect(await screen.findByText('Say hello', { selector: 'div' })).toBeTruthy()
    expect((box as HTMLTextAreaElement).value).toBe('')
    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({
        thread: expect.stringMatching(/^thr_/),
      }),
    )
    expect(await screen.findByRole('button', { name: 'Stop' })).toBeTruthy()
    expect(screen.getByRole('status', { name: 'Inbox Sweeper is thinking' })).toBeTruthy()
    await waitFor(() => expect(railMascot()).toBe('thinking'))

    await fake.server.stream('Hel')
    await fake.server.stream('lo')
    const streaming = await screen.findByRole('article', { name: 'Inbox Sweeper is replying' })
    expect(streaming.textContent).toBe('Hello')
    expect(screen.getByText('Writing')).toBeTruthy()

    await fake.server.finish('Hello there, **owner**.')
    const reply = await screen.findByRole('article', { name: 'Reply' })
    expect(reply.textContent).toContain('Hello there, owner.')
    expect(within(reply).getByText('owner').tagName).toBe('STRONG')
    await waitFor(() =>
      expect(screen.queryByRole('article', { name: 'Inbox Sweeper is replying' })).toBeNull(),
    )
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy()
    expect(screen.getByText('Inbox Sweeper replied.')).toBeTruthy()
    await waitFor(() => expect(railMascot()).toBe('done'))
  })

  it('keeps Shift+Enter as a new line and never sends an empty message', async () => {
    const fake = fakeApi({ profiles: [sweeper()] })
    const { user } = await renderApp('/t/inbox-sweeper', fake.api)
    const box = await screen.findByLabelText('Message Inbox Sweeper')
    await user.type(box, '   {Enter}')
    await user.type(box, 'line one{Shift>}{Enter}{/Shift}line two')
    expect((box as HTMLTextAreaElement).value).toBe('   line one\nline two')
    expect(fake.chat.started).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(fake.chat.started[0]?.prompt).toBe('line one\nline two')
  })

  it('stops a running reply', async () => {
    const fake = fakeApi({ profiles: [sweeper()] })
    const { user } = await renderApp('/t/inbox-sweeper', fake.api)
    await user.type(await screen.findByLabelText('Message Inbox Sweeper'), 'Write a lot{Enter}')
    await fake.server.stream('Once upon')
    await user.click(await screen.findByRole('button', { name: 'Stop' }))
    expect(fake.chat.cancelled).toHaveLength(1)
    expect(await screen.findByText(/Stopped\. Nothing more will happen/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy()
  })

  it('explains a failed run and how to fix it', async () => {
    const fake = fakeApi({ profiles: [sweeper()] })
    const { user } = await renderApp('/t/inbox-sweeper', fake.api)
    await user.type(await screen.findByLabelText('Message Inbox Sweeper'), 'hi{Enter}')
    await screen.findByRole('button', { name: 'Stop' })
    await fake.server.fail('plan_limit_reached')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/reached your plan's usage limit/)
    expect(within(alert).getByRole('link', { name: 'Open model settings' })).toBeTruthy()
    await waitFor(() => expect(railMascot()).toBe('error'))
  })

  it('keeps the draft and says why when sending fails', async () => {
    const fake = fakeApi({ profiles: [sweeper()] })
    fake.chat.startError = new Error('socket closed')
    const { user } = await renderApp('/t/inbox-sweeper', fake.api)
    const box = await screen.findByLabelText('Message Inbox Sweeper')
    await user.type(box, 'hello{Enter}')
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /Couldn't reach the Faire server/,
    )
    expect((box as HTMLTextAreaElement).value).toBe('hello')
    expect(screen.queryByText('Sending…')).toBeNull()
  })

  it('fills the composer from a suggestion', async () => {
    const fake = fakeApi({ profiles: [sweeper()] })
    const { user } = await renderApp('/t/inbox-sweeper', fake.api)
    await user.click(await screen.findByRole('button', { name: 'What can you help me with?' }))
    const box = screen.getByLabelText('Message Inbox Sweeper') as HTMLTextAreaElement
    expect(box.value).toBe('What can you help me with?')
    expect(document.activeElement).toBe(box)
    expect(fake.chat.started).toEqual([])
  })

  it('opens the latest conversation with its history and a collapsed tool card', async () => {
    const p = sweeper()
    const fake = fakeApi({ profiles: [p] })
    const t = thread(p.id, { title: 'Morning sweep' })
    fake.chat.threads.push(t)
    fake.chat.messages.push(
      message(t.id, 'user', 'Morning sweep please'),
      message(t.id, 'assistant', [
        { type: 'text', text: 'On it.' },
        {
          type: 'tool_call',
          toolCallId: 'c1',
          tool: 'web_fetch',
          args: { url: 'https://example.com' },
        },
        { type: 'tool_result', toolCallId: 'c1', result: { ok: true }, isError: false },
        { type: 'text', text: 'Done with the sweep.' },
      ]),
    )
    const { user } = await renderApp('/t/inbox-sweeper', fake.api)
    expect(await screen.findByText('Morning sweep please')).toBeTruthy()
    expect(screen.getByText('Done with the sweep.')).toBeTruthy()
    const card = screen.getByRole('button', { name: 'Used web fetch' })
    expect(card.getAttribute('aria-expanded')).toBe('false')
    await user.click(card)
    expect(card.getAttribute('aria-expanded')).toBe('true')
    expect(await screen.findByText(/https:\/\/example\.com/)).toBeTruthy()
  })

  it('picks up a run that is still going after a reload', async () => {
    const p = sweeper()
    const fake = fakeApi({ profiles: [p] })
    const t = thread(p.id)
    fake.chat.threads.push(t)
    const started = await fake.api.runs.start({
      profileId: p.id,
      threadId: t.id,
      prompt: 'long task',
    })
    await fake.server.running(started.id)
    await renderApp(`/t/inbox-sweeper?thread=${t.id}`, fake.api)
    expect(await screen.findByRole('button', { name: 'Stop' })).toBeTruthy()
    expect(screen.getByText('Thinking')).toBeTruthy()
  })

  it('switches between conversations and starts a new one', async () => {
    const p = sweeper()
    const fake = fakeApi({ profiles: [p] })
    const older = thread(p.id, { title: 'Older chat', lastEventAt: '2026-10-17T10:00:00.000Z' })
    const newer = thread(p.id, { title: 'Newer chat', lastEventAt: '2026-10-18T10:00:00.000Z' })
    fake.chat.threads.push(older, newer)
    fake.chat.messages.push(message(older.id, 'user', 'from the older chat'))
    fake.chat.messages.push(message(newer.id, 'user', 'from the newer chat'))
    const { user, router } = await renderApp('/t/inbox-sweeper', fake.api)
    expect(await screen.findByText('from the newer chat')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /Conversation: Newer chat/ }))
    await user.click(await screen.findByRole('menuitem', { name: /Older chat/ }))
    expect(await screen.findByText('from the older chat')).toBeTruthy()
    expect(router.state.location.search).toEqual({ thread: older.id as ThreadId })

    await user.click(screen.getByRole('button', { name: /Conversation: Older chat/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'New chat' }))
    expect(await screen.findByRole('heading', { name: 'Ask Inbox Sweeper anything' })).toBeTruthy()
  })

  it('says so when the teammate does not exist', async () => {
    const fake = fakeApi({ profiles: [sweeper()] })
    await renderApp('/t/nobody', fake.api)
    expect(await screen.findByRole('heading', { name: 'No teammate here' })).toBeTruthy()
  })

  it('shows a retry when the conversation cannot load', async () => {
    const p = sweeper()
    const fake = fakeApi({ profiles: [p] })
    fake.chat.threads.push(thread(p.id))
    fake.chat.messagesError = new Error('down')
    const { user } = await renderApp('/t/inbox-sweeper', fake.api)
    expect(
      await screen.findByRole('heading', { name: "Couldn't load this conversation" }),
    ).toBeTruthy()
    fake.chat.messagesError = null
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: "Couldn't load this conversation" })).toBeNull(),
    )
  })

  it('shows the run in the context panel', async () => {
    const fake = fakeApi({ profiles: [sweeper()] })
    const { user } = await renderApp('/t/inbox-sweeper', fake.api)
    await user.type(await screen.findByLabelText('Message Inbox Sweeper'), 'hi{Enter}')
    await fake.server.finish('hey')
    await user.click(screen.getByRole('tab', { name: 'Run' }))
    const panel = screen.getByRole('complementary', { name: 'Context' })
    expect(await within(panel).findByText('Done')).toBeTruthy()
    expect(within(panel).getByText('34')).toBeTruthy()
  })
})
