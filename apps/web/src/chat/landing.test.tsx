import type { ProviderCredential } from '@mawl/contracts'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { APPEARANCE_STORAGE_KEY } from '../appearance/prefs.ts'
import { PROFILE_STORAGE_KEY } from '../profile/profile-prefs.ts'
import { message, profile, thread } from '../test/fake-chat-api.ts'
import { credential } from '../test/fake-providers-api.ts'
import { fakeApi, renderApp, stubViewport } from '../test/render-app.tsx'

beforeAll(async () => {
  await import('./ChatView.tsx')
})
beforeEach(() => stubViewport(1440))

const CRED = 'cred_01JTEST0000000000000000001' as ProviderCredential['id']

const sweeper = () => profile({ name: 'Inbox Sweeper', slug: 'inbox-sweeper' })

const headerMascot = () => document.querySelector('section[aria-label^="Chat with"] header .mawl')

describe('new-chat landing', () => {
  it('greets the owner without a name when none is set', async () => {
    const fake = fakeApi({ profiles: [sweeper()] })
    await renderApp('/t/inbox-sweeper', fake.api)
    expect(await screen.findByRole('heading', { level: 2, name: "What's next?" })).toBeTruthy()
  })

  it('greets the owner by first name from the profile', async () => {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify({ name: 'Sam Rivera', context: '' }))
    const fake = fakeApi({ profiles: [sweeper()] })
    await renderApp('/t/inbox-sweeper', fake.api)
    expect(await screen.findByRole('heading', { level: 2, name: "What's next, Sam?" })).toBeTruthy()
  })

  it('offers three suggestions that fill the composer without sending', async () => {
    const fake = fakeApi({ profiles: [sweeper()] })
    const { user } = await renderApp('/t/inbox-sweeper', fake.api)
    await screen.findByRole('heading', { name: "What's next?" })
    for (const s of ['Plan my week', 'Summarize something', 'Draft a reply']) {
      expect(screen.getByRole('button', { name: s })).toBeTruthy()
    }
    await user.click(screen.getByRole('button', { name: 'Draft a reply' }))
    const box = screen.getByLabelText('Message Inbox Sweeper') as HTMLTextAreaElement
    expect(box.value).toBe('Draft a reply')
    expect(document.activeElement).toBe(box)
    expect(fake.chat.started).toEqual([])
  })

  it('shows the big Mawl on the landing and none in the header', async () => {
    const fake = fakeApi({ profiles: [sweeper()] })
    await renderApp('/t/inbox-sweeper', fake.api)
    const heading = await screen.findByRole('heading', { name: "What's next?" })
    const landing = heading.closest('[aria-label="New chat"]')
    expect(landing?.querySelector('.mawl')?.getAttribute('width')).toBe('120')
    expect(headerMascot()).toBeNull()
  })

  it('docks the same composer after the first send and moves Mawl into the header', async () => {
    const fake = fakeApi({ profiles: [sweeper()] })
    const { user } = await renderApp('/t/inbox-sweeper', fake.api)
    await screen.findByRole('heading', { name: "What's next?" })
    const box = screen.getByLabelText('Message Inbox Sweeper')
    await user.type(box, 'Say hello{Enter}')
    await waitFor(() => expect(screen.queryByRole('heading', { name: "What's next?" })).toBeNull())
    expect(screen.queryByRole('button', { name: 'Plan my week' })).toBeNull()
    // Same element: the textarea kept its focus and was never remounted.
    expect(screen.getByLabelText('Message Inbox Sweeper')).toBe(box)
    expect(document.activeElement).toBe(box)
    await waitFor(() => expect(headerMascot()?.getAttribute('data-state')).toBe('thinking'))
  })
})

describe('composer', () => {
  it('has a round send button that is disabled until there is text', async () => {
    const fake = fakeApi({ profiles: [sweeper()] })
    const { user } = await renderApp('/t/inbox-sweeper', fake.api)
    const send = (await screen.findByRole('button', { name: 'Send' })) as HTMLButtonElement
    expect(send.className).toMatch(/rounded-pill/)
    expect(send.className).toMatch(/(^|\s)size-8(\s|$)/)
    expect(send.disabled).toBe(true)
    await user.type(screen.getByLabelText('Message Inbox Sweeper'), 'hi')
    expect(send.disabled).toBe(false)
  })

  it('keeps a 44 px touch target on coarse pointers without a bigger circle', async () => {
    const fake = fakeApi({ profiles: [sweeper()] })
    await renderApp('/t/inbox-sweeper', fake.api)
    const send = await screen.findByRole('button', { name: 'Send' })
    expect(send.className).toMatch(/pointer-coarse:before:/)
    const add = screen.getByRole('button', { name: 'Add to message' })
    expect(add.className).toMatch(/(^|\s)size-8(\s|$)/)
    expect(add.className).toMatch(/rounded-pill/)
  })

  it('has no model chip in the composer; the header shows a quiet model pill', async () => {
    const fake = fakeApi({
      profiles: [sweeper()],
      credentials: [credential({ id: CRED, label: 'Test provider' })],
    })
    await renderApp('/t/inbox-sweeper', fake.api)
    await screen.findByRole('heading', { name: "What's next?" })
    const form = screen.getByLabelText('Message Inbox Sweeper').closest('form')
    expect(form?.textContent).not.toContain('gpt-test')
    const header = document.querySelector('section[aria-label^="Chat with"] header')
    const pill = within(header as HTMLElement).getByText('gpt-test')
    expect(pill.tagName).toBe('SPAN')
    expect(pill.closest('button, a')).toBeNull()
    await waitFor(() => expect(pill.getAttribute('title')).toBe('Test provider / gpt-test'))
  })

  it('still shows the model pill once the conversation is docked', async () => {
    const fake = fakeApi({ profiles: [sweeper()] })
    const { user } = await renderApp('/t/inbox-sweeper', fake.api)
    await user.type(await screen.findByLabelText('Message Inbox Sweeper'), 'hi{Enter}')
    await waitFor(() => expect(screen.queryByRole('heading', { name: "What's next?" })).toBeNull())
    const header = document.querySelector('section[aria-label^="Chat with"] header')
    expect(within(header as HTMLElement).getByText('gpt-test')).toBeTruthy()
  })

  it('turns the send button into a round stop button while the reply streams', async () => {
    const fake = fakeApi({ profiles: [sweeper()] })
    const { user } = await renderApp('/t/inbox-sweeper', fake.api)
    await user.type(await screen.findByLabelText('Message Inbox Sweeper'), 'hi{Enter}')
    await fake.server.stream('He')
    const stop = await screen.findByRole('button', { name: 'Stop' })
    expect(stop.className).toMatch(/rounded-pill/)
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
  })

  it('opens the add menu with only an honest, disabled attach item', async () => {
    const fake = fakeApi({ profiles: [sweeper()] })
    const { user } = await renderApp('/t/inbox-sweeper', fake.api)
    await user.click(await screen.findByRole('button', { name: 'Add to message' }))
    const menu = await screen.findByRole('menu')
    const items = within(menu).getAllByRole('menuitem')
    expect(items).toHaveLength(1)
    expect(items[0]?.textContent).toBe('Attach files, soon')
    expect(items[0]?.getAttribute('aria-disabled')).toBe('true')
  })
})

describe('messages', () => {
  it('folds several tool calls into one pill that expands to the steps', async () => {
    const p = sweeper()
    const fake = fakeApi({ profiles: [p] })
    const t = thread(p.id)
    fake.chat.threads.push(t)
    fake.chat.messages.push(
      message(t.id, 'user', 'sweep'),
      message(t.id, 'assistant', [
        { type: 'tool_call', toolCallId: 'a', tool: 'web_fetch', args: { url: 'x' } },
        { type: 'tool_call', toolCallId: 'b', tool: 'mcp__mail__list_inbox', args: {} },
        { type: 'tool_result', toolCallId: 'a', result: 'ok', isError: false },
        { type: 'tool_result', toolCallId: 'b', result: 'boom', isError: true },
        { type: 'text', text: 'Done.' },
      ]),
    )
    const { user } = await renderApp('/t/inbox-sweeper', fake.api)
    const pill = await screen.findByRole('button', { name: "Used 2 tools, 1 didn't work" })
    expect(pill.className).toMatch(/rounded-pill/)
    expect(screen.queryByText('Web fetch')).toBeNull()
    await user.click(pill)
    expect(pill.getAttribute('aria-expanded')).toBe('true')
    expect(await screen.findByText('Web fetch')).toBeTruthy()
    expect(screen.getByText('List inbox on mail')).toBeTruthy()
  })

  it('shows reasoning as a muted Thinking disclosure', async () => {
    const p = sweeper()
    const fake = fakeApi({ profiles: [p] })
    const t = thread(p.id)
    fake.chat.threads.push(t)
    fake.chat.messages.push(
      message(t.id, 'assistant', [
        { type: 'reasoning', text: 'First check the inbox.' },
        { type: 'text', text: 'All clear.' },
      ]),
    )
    const { user } = await renderApp('/t/inbox-sweeper', fake.api)
    const toggle = await screen.findByRole('button', { name: 'Thinking' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('First check the inbox.')).toBeNull()
    await user.click(toggle)
    expect(await screen.findByText('First check the inbox.')).toBeTruthy()
  })

  it('puts code in a card with a copy button', async () => {
    const p = sweeper()
    const fake = fakeApi({ profiles: [p] })
    const t = thread(p.id)
    fake.chat.threads.push(t)
    fake.chat.messages.push(message(t.id, 'assistant', '```ts\nconst a = 1\n```'))
    const { user } = await renderApp('/t/inbox-sweeper', fake.api)
    const copy = await screen.findByRole('button', { name: 'Copy code' })
    expect(screen.getByText('ts')).toBeTruthy()
    await user.click(copy)
    expect(await navigator.clipboard.readText()).toBe('const a = 1\n')
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy()
  })

  it('offers Try again after a failed run and sends the same message again', async () => {
    const fake = fakeApi({ profiles: [sweeper()] })
    const { user } = await renderApp('/t/inbox-sweeper', fake.api)
    await user.type(await screen.findByLabelText('Message Inbox Sweeper'), 'do it{Enter}')
    await screen.findByRole('button', { name: 'Stop' })
    await fake.server.fail('provider_error')
    const alert = await screen.findByRole('alert')
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(fake.chat.started).toHaveLength(2))
    expect(fake.chat.started[1]?.prompt).toBe('do it')
  })
})

describe('scroll to bottom', () => {
  it('appears when the owner scrolls up and jumps back down', async () => {
    const p = sweeper()
    const fake = fakeApi({ profiles: [p] })
    const t = thread(p.id)
    fake.chat.threads.push(t)
    fake.chat.messages.push(message(t.id, 'user', 'one'), message(t.id, 'assistant', 'two'))
    const { user } = await renderApp('/t/inbox-sweeper', fake.api)
    const log = await screen.findByRole('region', { name: 'Messages' })
    expect(screen.queryByRole('button', { name: 'Jump to latest' })).toBeNull()
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 2000 })
    Object.defineProperty(log, 'clientHeight', { configurable: true, value: 500 })
    log.scrollTop = 100
    fireEvent.scroll(log)
    const jump = await screen.findByRole('button', { name: 'Jump to latest' })
    expect(jump.className).toMatch(/rounded-pill/)
    log.scrollTo = () => {}
    await user.click(jump)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Jump to latest' })).toBeNull())
  })

  it.each([
    ['smooth', false],
    ['auto', true],
  ] as const)('jumps with %s scrolling when reduced motion is %s', async (behavior, reduced) => {
    // The provider owns the class on <html>, so set the stored preference it reads.
    localStorage.setItem(
      APPEARANCE_STORAGE_KEY,
      JSON.stringify({ theme: 'light', accent: '#CBB9F4', reduceMotion: reduced }),
    )
    try {
      const p = sweeper()
      const fake = fakeApi({ profiles: [p] })
      const t = thread(p.id)
      fake.chat.threads.push(t)
      fake.chat.messages.push(message(t.id, 'user', 'one'), message(t.id, 'assistant', 'two'))
      const { user } = await renderApp('/t/inbox-sweeper', fake.api)
      const log = await screen.findByRole('region', { name: 'Messages' })
      Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 2000 })
      Object.defineProperty(log, 'clientHeight', { configurable: true, value: 500 })
      log.scrollTop = 100
      fireEvent.scroll(log)
      const scrollTo = vi.fn()
      log.scrollTo = scrollTo
      await user.click(await screen.findByRole('button', { name: 'Jump to latest' }))
      expect(scrollTo).toHaveBeenCalledWith({ top: 2000, behavior })
    } finally {
      localStorage.removeItem(APPEARANCE_STORAGE_KEY)
    }
  })
})

describe('composer focus', () => {
  it('draws no ring on the pill or the text field when focused', async () => {
    const fake = fakeApi({ profiles: [sweeper()] })
    const { user } = await renderApp('/t/inbox-sweeper', fake.api)
    await screen.findByRole('heading', { name: "What's next?" })
    const box = screen.getByLabelText('Message Inbox Sweeper')
    await user.click(box)
    expect(document.activeElement).toBe(box)
    const form = box.closest('form') as HTMLFormElement
    for (const el of [form, box]) {
      expect(el.className).not.toMatch(/focus-within|focus:|focus-visible|ring/)
    }
  })
})
