import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OwnerTokenGate } from './OwnerTokenGate.tsx'
import { OWNER_TOKEN_KEY, type TokenCheck } from './token.ts'

const RIGHT = 'right-owner-token_0123456789abcdefghij'
const WRONG = 'wrong-owner-token_0123456789abcdefghij'

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function setup(opts: { launch?: string; verify?: (token: string) => Promise<TokenCheck> } = {}) {
  const verify = vi.fn(opts.verify ?? (async (t: string) => (t === RIGHT ? 'ok' : 'unauthorized')))
  const user = userEvent.setup()
  render(
    <OwnerTokenGate
      verify={verify}
      storage={sessionStorage}
      {...(opts.launch ? { launch: opts.launch } : {})}
    >
      {(token) => <p>App with {token}</p>}
    </OwnerTokenGate>,
  )
  return { verify, user }
}

describe('OwnerTokenGate', () => {
  afterEach(() => sessionStorage.clear())

  it('opens the app at once with the desktop launch token, asking nothing', () => {
    const { verify } = setup({ launch: RIGHT })
    expect(screen.getByText(`App with ${RIGHT}`)).toBeTruthy()
    expect(verify).not.toHaveBeenCalled()
  })

  it('asks for the owner token when none is saved, with a labelled field', async () => {
    setup()
    expect(await screen.findByRole('heading', { name: 'Enter your owner token' })).toBeTruthy()
    const field = screen.getByLabelText('Owner token')
    expect(field.getAttribute('type')).toBe('password')
    expect(field.getAttribute('autocomplete')).toBe('off')
    expect(screen.queryByText(/App with/)).toBeNull()
  })

  it('says what is missing when submitted empty, without calling the server', async () => {
    const { verify, user } = setup()
    await user.click(await screen.findByRole('button', { name: 'Open Mawl' }))
    expect(await screen.findByText('Enter the owner token.')).toBeTruthy()
    expect(screen.getByLabelText('Owner token').getAttribute('aria-invalid')).toBe('true')
    expect(verify).not.toHaveBeenCalled()
  })

  it('shows an error for a wrong token, clears the field and saves nothing', async () => {
    const { user } = setup()
    await user.type(await screen.findByLabelText('Owner token'), WRONG)
    await user.click(screen.getByRole('button', { name: 'Open Mawl' }))
    expect(await screen.findByText("That token didn't work. Check it and try again.")).toBeTruthy()
    expect((screen.getByLabelText('Owner token') as HTMLInputElement).value).toBe('')
    expect(document.activeElement).toBe(screen.getByLabelText('Owner token'))
    expect(sessionStorage.getItem(OWNER_TOKEN_KEY)).toBeNull()
  })

  it('clears the field again after a second wrong token', async () => {
    const { user, verify } = setup()
    for (let i = 0; i < 2; i++) {
      await user.type(await screen.findByLabelText('Owner token'), WRONG)
      await user.click(screen.getByRole('button', { name: 'Open Mawl' }))
      await screen.findByRole('alert')
      expect((screen.getByLabelText('Owner token') as HTMLInputElement).value).toBe('')
    }
    expect(verify).toHaveBeenCalledTimes(2)
  })

  it('opens the app with the right token and keeps it for this tab', async () => {
    const { user } = setup()
    await user.type(await screen.findByLabelText('Owner token'), `  ${RIGHT}  `)
    await user.click(screen.getByRole('button', { name: 'Open Mawl' }))
    expect(await screen.findByText(`App with ${RIGHT}`)).toBeTruthy()
    expect(sessionStorage.getItem(OWNER_TOKEN_KEY)).toBe(RIGHT)
  })

  it('disables the button and says so while checking', async () => {
    const pending = deferred<TokenCheck>()
    const { user } = setup({ verify: () => pending.promise })
    await user.type(await screen.findByLabelText('Owner token'), RIGHT)
    await user.click(screen.getByRole('button', { name: 'Open Mawl' }))
    expect((screen.getByRole('button', { name: 'Checking…' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    pending.resolve('ok')
    expect(await screen.findByText(`App with ${RIGHT}`)).toBeTruthy()
  })

  it('checks a saved token first and opens the app when it still works', async () => {
    sessionStorage.setItem(OWNER_TOKEN_KEY, RIGHT)
    const pending = deferred<TokenCheck>()
    setup({ verify: () => pending.promise })
    expect(screen.getByRole('status').textContent).toContain('Connecting to Mawl')
    pending.resolve('ok')
    expect(await screen.findByText(`App with ${RIGHT}`)).toBeTruthy()
  })

  it('forgets a saved token the server refuses and asks again', async () => {
    sessionStorage.setItem(OWNER_TOKEN_KEY, WRONG)
    setup()
    expect(
      await screen.findByText('Your saved token no longer works. Enter the current one.'),
    ).toBeTruthy()
    expect(sessionStorage.getItem(OWNER_TOKEN_KEY)).toBeNull()
  })

  it('says when the server cannot be reached and tries again on request', async () => {
    let reachable = false
    const { user, verify } = setup({
      verify: async (t) => (reachable ? (t === RIGHT ? 'ok' : 'unauthorized') : 'unreachable'),
    })
    await user.type(await screen.findByLabelText('Owner token'), RIGHT)
    await user.click(screen.getByRole('button', { name: 'Open Mawl' }))
    expect(await screen.findByText("Can't reach the Mawl server")).toBeTruthy()
    reachable = true
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText(`App with ${RIGHT}`)).toBeTruthy()
    expect(verify).toHaveBeenCalledTimes(2)
  })
})
