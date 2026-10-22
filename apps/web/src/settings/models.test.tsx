import type { CredentialId } from '@mawl/contracts'
import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, credential, fakeProvidersApi } from '../test/fake-providers-api.ts'
import { renderApp, stubViewport } from '../test/render-app.tsx'

const models = () => screen.getByRole('region', { name: 'Models and keys' })

beforeEach(() => {
  stubViewport(1440)
  vi.spyOn(window, 'open').mockReturnValue(null)
})

describe('settings, models: empty and failure states', () => {
  it('offers ChatGPT first, then the Claude plan, then an API key', async () => {
    await renderApp('/settings?section=models', { providers: fakeProvidersApi().api })
    const region = models()
    const buttons = await within(region).findAllByRole('button')
    const names = buttons.map((b) => b.textContent)
    expect(names.indexOf('Continue with ChatGPT')).toBeLessThan(
      names.indexOf('Use your Claude plan'),
    )
    expect(names.indexOf('Use your Claude plan')).toBeLessThan(names.indexOf('Add an API key'))
    expect(within(region).getByText('No model connected yet.')).toBeTruthy()
  })

  it('explains an unreachable server and retries', async () => {
    const fake = fakeProvidersApi()
    fake.state.listError = new Error('Failed to fetch')
    const { user } = await renderApp('/settings?section=models', { providers: fake.api })
    expect(await within(models()).findByText(/Couldn't reach the Mawl server/)).toBeTruthy()
    fake.state.listError = null
    await user.click(within(models()).getByRole('button', { name: 'Try again' }))
    expect(await within(models()).findByText('No model connected yet.')).toBeTruthy()
  })
})

describe('settings, models: Sign in with ChatGPT', () => {
  it('opens the sign-in page, waits, then shows the plan in use', async () => {
    const fake = fakeProvidersApi()
    fake.state.statuses = [
      { status: 'pending' },
      { status: 'succeeded', credentialId: 'cred_01JTESTCHATGPT0000000000001' as CredentialId },
    ]
    const { user } = await renderApp('/settings?section=models', { providers: fake.api })
    await user.click(await within(models()).findByRole('button', { name: 'Continue with ChatGPT' }))
    expect(window.open).toHaveBeenCalledWith(
      'https://auth.openai.com/api/accounts/authorize?client_id=x',
      '_blank',
      'noopener,noreferrer',
    )
    expect(await within(models()).findByText(/Finish signing in/)).toBeTruthy()
    expect(await within(models()).findByText('Using ChatGPT plan')).toBeTruthy()
    const manage = within(models()).getByRole('link', { name: 'Manage usage' })
    expect(manage.getAttribute('href')).toBe('https://chatgpt.com/settings/usage')
  })

  it('says why a sign-in failed', async () => {
    const fake = fakeProvidersApi()
    fake.state.statuses = [{ status: 'failed', reason: 'access_denied' }]
    const { user } = await renderApp('/settings?section=models', { providers: fake.api })
    await user.click(await within(models()).findByRole('button', { name: 'Continue with ChatGPT' }))
    expect(await within(models()).findByText('Sign-in was cancelled in ChatGPT.')).toBeTruthy()
  })

  it('stops polling and says so when the status check fails', async () => {
    const fake = fakeProvidersApi()
    fake.state.statusError = new ApiError('NOT_FOUND')
    const { user } = await renderApp('/settings?section=models', { providers: fake.api })
    await user.click(await within(models()).findByRole('button', { name: 'Continue with ChatGPT' }))
    expect(await within(models()).findByText(/lost track of this sign-in/)).toBeTruthy()
    const calls = fake.state.statusCalls
    await new Promise((r) => setTimeout(r, 120))
    expect(fake.state.statusCalls).toBe(calls)
  })

  it('keeps waiting through a dropped connection and still finishes the sign-in', async () => {
    const fake = fakeProvidersApi()
    fake.state.statusError = new Error('socket closed')
    fake.state.statuses = [
      { status: 'succeeded', credentialId: 'cred_01JTESTCHATGPT0000000000001' as CredentialId },
    ]
    const { user } = await renderApp('/settings?section=models', { providers: fake.api })
    await user.click(await within(models()).findByRole('button', { name: 'Continue with ChatGPT' }))
    await waitFor(() => expect(fake.state.statusCalls).toBeGreaterThanOrEqual(2))
    expect(within(models()).queryByText(/lost track of this sign-in/)).toBeNull()
    fake.state.statusError = null
    expect(await within(models()).findByText('Using ChatGPT plan')).toBeTruthy()
  })

  it('shows a sign-in that finished on the server after the owner stopped waiting', async () => {
    const fake = fakeProvidersApi()
    const { user } = await renderApp('/settings?section=models', { providers: fake.api })
    await user.click(await within(models()).findByRole('button', { name: 'Continue with ChatGPT' }))
    // The server finished the sign-in, but the page has not polled it yet.
    fake.state.credentials.push(
      credential({ provider: 'openai_chatgpt', label: 'ChatGPT', planUsage: true }),
    )
    await user.click(await within(models()).findByRole('button', { name: 'Stop waiting' }))
    expect(await within(models()).findByText('Using ChatGPT plan')).toBeTruthy()
  })

  it('stops waiting when asked', async () => {
    const fake = fakeProvidersApi()
    const { user } = await renderApp('/settings?section=models', { providers: fake.api })
    await user.click(await within(models()).findByRole('button', { name: 'Continue with ChatGPT' }))
    await user.click(await within(models()).findByRole('button', { name: 'Stop waiting' }))
    expect(within(models()).queryByText(/Finish signing in/)).toBeNull()
    const calls = fake.state.statusCalls
    await new Promise((r) => setTimeout(r, 120))
    expect(fake.state.statusCalls).toBe(calls)
    expect(
      within(models())
        .getByRole('button', { name: 'Continue with ChatGPT' })
        .hasAttribute('disabled'),
    ).toBe(false)
  })

  it('explains a busy sign-in port', async () => {
    const fake = fakeProvidersApi()
    fake.state.startError = new ApiError('SIGN_IN_UNAVAILABLE')
    const { user } = await renderApp('/settings?section=models', { providers: fake.api })
    await user.click(await within(models()).findByRole('button', { name: 'Continue with ChatGPT' }))
    expect(await within(models()).findByText(/port 1455/)).toBeTruthy()
  })

  it('asks to sign in again when the tokens were revoked', async () => {
    const fake = fakeProvidersApi([
      credential({
        provider: 'openai_chatgpt',
        label: 'ChatGPT',
        reauthRequired: true,
        planUsage: true,
      }),
    ])
    await renderApp('/settings?section=models', { providers: fake.api })
    expect(await within(models()).findByText('Signed out of ChatGPT')).toBeTruthy()
    expect(within(models()).getByRole('button', { name: 'Sign in again' })).toBeTruthy()
    expect(within(models()).queryByText('Using ChatGPT plan')).toBeNull()
  })

  it('shows "Usage limit reached" when a check hits the plan limit', async () => {
    const row = credential({ provider: 'openai_chatgpt', label: 'ChatGPT', planUsage: true })
    const fake = fakeProvidersApi([row])
    fake.state.testResults.set(row.id, { ok: false, reason: 'rate_limited' })
    const { user } = await renderApp('/settings?section=models', { providers: fake.api })
    await user.click(await within(models()).findByRole('button', { name: 'Check ChatGPT' }))
    expect(await within(models()).findByText('Usage limit reached')).toBeTruthy()
  })

  it('tells the owner to revoke access when sign-out was not confirmed', async () => {
    const row = credential({ provider: 'openai_chatgpt', label: 'ChatGPT', planUsage: true })
    const fake = fakeProvidersApi([row])
    fake.state.revoked = false
    const { user } = await renderApp('/settings?section=models', { providers: fake.api })
    await user.click(await within(models()).findByRole('button', { name: 'Sign out of ChatGPT' }))
    const confirm = await screen.findByRole('alertdialog')
    await user.click(within(confirm).getByRole('button', { name: 'Sign out' }))
    const notice = await within(models()).findByRole('alert')
    expect(notice.textContent).toMatch(/Revoke it in ChatGPT settings/)
    expect(within(notice).getByRole('link', { name: 'ChatGPT settings' })).toBeTruthy()
    expect(fake.state.removed).toEqual([row.id])
  })

  it('moves focus to the Models and keys heading after a removal, not to the page body', async () => {
    const row = credential({ provider: 'anthropic', label: 'Work key' })
    const fake = fakeProvidersApi([row])
    const { user } = await renderApp('/settings?section=models', { providers: fake.api })
    await user.click(await within(models()).findByRole('button', { name: 'Remove Work key' }))
    const confirm = await screen.findByRole('alertdialog')
    await user.click(within(confirm).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(within(models()).queryByText('Work key')).toBeNull())
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Models and keys' })),
    )
  })
})

describe('settings, models: Claude plan', () => {
  it('adds the Claude plan and explains a missing Claude Code login', async () => {
    const fake = fakeProvidersApi()
    const { user } = await renderApp('/settings?section=models', { providers: fake.api })
    await user.click(await within(models()).findByRole('button', { name: 'Use your Claude plan' }))
    expect(within(models()).getByText('claude auth login')).toBeTruthy()
    fake.state.testResults.clear()
    await user.click(within(models()).getByRole('button', { name: 'Add Claude plan' }))
    await waitFor(() =>
      expect(fake.state.created).toEqual([
        { provider: 'anthropic_claude_code', label: 'Claude plan' },
      ]),
    )
    const added = fake.state.credentials[0]
    if (added) fake.state.testResults.set(added.id, { ok: false, reason: 'not_signed_in' })
    await user.click(await within(models()).findByRole('button', { name: 'Check Claude plan' }))
    expect(await within(models()).findByText(/Claude Code isn't signed in/)).toBeTruthy()
  })
})

describe('settings, models: API keys', () => {
  it('checks a key before saving it', async () => {
    const fake = fakeProvidersApi()
    const { user } = await renderApp('/settings?section=models', { providers: fake.api })
    await user.click(await within(models()).findByRole('button', { name: 'Add an API key' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add an API key' })
    await user.type(within(dialog).getByLabelText('API key'), 'sk-test-123')
    await user.click(within(dialog).getByRole('button', { name: 'Check and save' }))
    await waitFor(() =>
      expect(fake.state.created).toEqual([
        { provider: 'anthropic', label: 'Anthropic', secret: 'sk-test-123' },
      ]),
    )
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add an API key' })).toBeNull())
    expect(await within(models()).findByRole('heading', { name: 'Anthropic' })).toBeTruthy()
  })

  it('keeps the dialog open and says why when the key is rejected', async () => {
    const fake = fakeProvidersApi()
    fake.state.inlineTest = { ok: false, reason: 'invalid_key' }
    const { user } = await renderApp('/settings?section=models', { providers: fake.api })
    await user.click(await within(models()).findByRole('button', { name: 'Add an API key' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add an API key' })
    await user.type(within(dialog).getByLabelText('API key'), 'sk-bad')
    await user.click(within(dialog).getByRole('button', { name: 'Check and save' }))
    expect(await within(dialog).findByText(/The key was rejected/)).toBeTruthy()
    expect(fake.state.created).toEqual([])
  })

  it('asks before checking an address on the private network, then saves without the flag', async () => {
    const fake = fakeProvidersApi()
    fake.state.inlineTest = (target) =>
      target.allowPrivateNetwork
        ? { ok: true, latencyMs: 5 }
        : { ok: false, reason: 'blocked_address' }
    const { user } = await renderApp('/settings?section=models', { providers: fake.api })
    await user.click(await within(models()).findByRole('button', { name: 'Add an API key' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add an API key' })
    await user.selectOptions(within(dialog).getByLabelText('Provider'), 'ollama')
    await user.type(within(dialog).getByLabelText(/Server address/), 'http://192.168.1.20:11434')
    await user.click(within(dialog).getByRole('button', { name: 'Check and save' }))
    expect(await within(dialog).findByText(/on this computer or your private network/)).toBeTruthy()
    expect(fake.state.created).toEqual([])
    await user.click(within(dialog).getByRole('button', { name: 'Allow and check again' }))
    await waitFor(() =>
      expect(fake.state.created).toEqual([
        { provider: 'ollama', label: 'Ollama', baseUrl: 'http://192.168.1.20:11434' },
      ]),
    )
    expect(fake.state.tested.map((t) => t.allowPrivateNetwork)).toEqual([undefined, true])
  })

  it('says an address is never reachable when it stays refused after allowing it', async () => {
    const fake = fakeProvidersApi()
    fake.state.inlineTest = { ok: false, reason: 'blocked_address' }
    const { user } = await renderApp('/settings?section=models', { providers: fake.api })
    await user.click(await within(models()).findByRole('button', { name: 'Add an API key' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add an API key' })
    await user.selectOptions(within(dialog).getByLabelText('Provider'), 'ollama')
    await user.type(within(dialog).getByLabelText(/Server address/), 'http://169.254.169.254')
    await user.click(within(dialog).getByRole('button', { name: 'Check and save' }))
    await user.click(await within(dialog).findByRole('button', { name: 'Allow and check again' }))
    expect(await within(dialog).findByText(/Mawl never connects to this address/)).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: 'Allow and check again' })).toBeNull()
    expect(fake.state.created).toEqual([])
  })

  it('requires an address for an OpenAI-compatible server', async () => {
    const fake = fakeProvidersApi()
    const { user } = await renderApp('/settings?section=models', { providers: fake.api })
    await user.click(await within(models()).findByRole('button', { name: 'Add an API key' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add an API key' })
    await user.selectOptions(within(dialog).getByLabelText('Provider'), 'openai_compatible')
    await user.click(within(dialog).getByRole('button', { name: 'Check and save' }))
    expect(await within(dialog).findByText('Enter the server address.')).toBeTruthy()
    expect(fake.state.created).toEqual([])
    // Focus moves to the first field that needs fixing.
    expect(document.activeElement).toBe(within(dialog).getByLabelText('Server address'))
  })

  it('starts on the provider field', async () => {
    const { user } = await renderApp('/settings?section=models', {
      providers: fakeProvidersApi().api,
    })
    await user.click(await within(models()).findByRole('button', { name: 'Add an API key' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add an API key' })
    await waitFor(() =>
      expect(document.activeElement).toBe(within(dialog).getByLabelText('Provider')),
    )
  })

  it('names a server-side validation error instead of blaming the connection', async () => {
    const fake = fakeProvidersApi()
    fake.state.createError = new ApiError('VALIDATION')
    const { user } = await renderApp('/settings?section=models', { providers: fake.api })
    await user.click(await within(models()).findByRole('button', { name: 'Add an API key' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add an API key' })
    await user.type(within(dialog).getByLabelText('API key'), 'sk-test')
    await user.click(within(dialog).getByRole('button', { name: 'Check and save' }))
    expect(await within(dialog).findByText(/The server didn't accept these details/)).toBeTruthy()
  })

  it('asks the owner to wait when the server limits key checks', async () => {
    const fake = fakeProvidersApi()
    fake.state.testError = new ApiError('RATE_LIMITED')
    const { user } = await renderApp('/settings?section=models', { providers: fake.api })
    await user.click(await within(models()).findByRole('button', { name: 'Add an API key' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add an API key' })
    await user.type(within(dialog).getByLabelText('API key'), 'sk-test')
    await user.click(within(dialog).getByRole('button', { name: 'Check and save' }))
    expect(
      await within(dialog).findByText(
        'Too many checks in a row. Wait a few seconds, then try again.',
      ),
    ).toBeTruthy()
    expect(fake.state.created).toEqual([])
  })
})
