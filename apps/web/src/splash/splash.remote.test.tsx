import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ConnectResult, HostBridge } from './bridge.ts'
import type { RemoteHealth, Target } from './remote.ts'
import { Splash } from './Splash.tsx'
import type { Status } from './status.ts'

const TOKEN = 'remote-owner-token_0123456789abcdefXYZ'

function fakeBridge({
  target = { kind: 'local' } as Target,
  status = { phase: 'ready' } as Status,
  checks = ['ready'] as RemoteHealth[],
}: {
  target?: Target
  status?: Status
  checks?: RemoteHealth[]
} = {}) {
  let emit: (s: Status) => void = () => {}
  const queue = [...checks]
  const bridge = {
    status: vi.fn(async () => status),
    onStatus: vi.fn(async (handler: (s: Status) => void) => {
      emit = handler
      return () => {}
    }),
    diagnostics: vi.fn(async () => 'diagnostics'),
    retry: vi.fn(async () => {}),
    quit: vi.fn(async () => {}),
    enterApp: vi.fn(async () => {}),
    shown: vi.fn(async () => {}),
    target: vi.fn(async () => target),
    checkRemote: vi.fn(async (): Promise<RemoteHealth> => queue.shift() ?? 'unreachable'),
    connectRemote: vi.fn(
      async (_url: string, _token: string): Promise<ConnectResult> => ({
        ok: true,
      }),
    ),
    switchToLocal: vi.fn(async (): Promise<ConnectResult> => ({ ok: true })),
  } satisfies HostBridge
  return { bridge, emit: (s: Status) => act(() => emit(s)) }
}

const REMOTE: Target = { kind: 'remote', origin: 'https://mawl.example.com/' }

describe('the splash with a remote Mawl', () => {
  it('connects to the remote and hands the window to it', async () => {
    const { bridge } = fakeBridge({ target: REMOTE, checks: ['ready'] })
    render(<Splash bridge={bridge} />)
    expect(await screen.findByText(/mawl\.example\.com/)).toBeTruthy()
    await vi.waitFor(() => expect(bridge.checkRemote).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(bridge.enterApp).toHaveBeenCalledTimes(1))
    // The local server's status is never asked for.
    expect(bridge.status).not.toHaveBeenCalled()
  })

  it('explains a failed check and offers try again, another address and this PC', async () => {
    const user = userEvent.setup()
    const { bridge } = fakeBridge({ target: REMOTE, checks: ['unreachable', 'ready'] })
    render(<Splash bridge={bridge} />)
    expect(
      await screen.findByRole('heading', { name: 'Can’t reach your remote Mawl' }),
    ).toBeTruthy()
    expect(screen.getByText(/couldn’t reach mawl\.example\.com/)).toBeTruthy()
    expect(bridge.enterApp).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await vi.waitFor(() => expect(bridge.enterApp).toHaveBeenCalledTimes(1))
  })

  it('switches back to this PC’s Mawl', async () => {
    const user = userEvent.setup()
    const { bridge } = fakeBridge({ target: REMOTE, checks: ['token_refused'] })
    render(<Splash bridge={bridge} />)
    await user.click(await screen.findByRole('button', { name: 'Use this PC’s Mawl' }))
    expect(bridge.switchToLocal).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('heading', { name: 'Restarting Mawl' })).toBeTruthy()
  })

  it('opens the form on the current address to change it', async () => {
    const user = userEvent.setup()
    const { bridge } = fakeBridge({ target: REMOTE, checks: ['not_mawl'] })
    render(<Splash bridge={bridge} />)
    await user.click(await screen.findByRole('button', { name: 'Change address' }))
    const address = screen.getByLabelText('Address') as HTMLInputElement
    expect(address.value).toBe('https://mawl.example.com/')
    expect((screen.getByLabelText('Owner token') as HTMLInputElement).value).toBe('')
  })
})

describe('the connect form', () => {
  it('sends the address and the token to the host and says Mawl restarts', async () => {
    const user = userEvent.setup()
    const { bridge } = fakeBridge()
    render(<Splash bridge={bridge} initialView="connect" />)
    expect(await screen.findByRole('heading', { name: 'Connect to a remote Mawl' })).toBeTruthy()
    const token = screen.getByLabelText('Owner token') as HTMLInputElement
    // A secret field: never shown, never autofilled.
    expect(token.type).toBe('password')
    expect(token.autocomplete).toBe('off')
    await user.type(screen.getByLabelText('Address'), 'https://mawl.example.com')
    await user.type(token, TOKEN)
    await user.click(screen.getByRole('button', { name: 'Connect' }))
    expect(bridge.connectRemote).toHaveBeenCalledWith('https://mawl.example.com', TOKEN)
    expect(await screen.findByRole('heading', { name: 'Restarting Mawl' })).toBeTruthy()
    // The connect form never let the splash enter the local app meanwhile.
    expect(bridge.enterApp).not.toHaveBeenCalled()
  })

  it('shows the host’s answer next to the field it is about and keeps the form usable', async () => {
    const user = userEvent.setup()
    const { bridge } = fakeBridge()
    bridge.connectRemote
      .mockResolvedValueOnce({ ok: false, error: { kind: 'url', reason: 'user_info' } })
      .mockResolvedValueOnce({ ok: false, error: { kind: 'remote', health: 'token_refused' } })
    render(<Splash bridge={bridge} initialView="connect" />)
    await user.type(await screen.findByLabelText('Address'), 'https://me:pw@mawl.example.com')
    await user.type(screen.getByLabelText('Owner token'), TOKEN)
    await user.click(screen.getByRole('button', { name: 'Connect' }))
    const address = screen.getByLabelText('Address')
    expect(address.getAttribute('aria-invalid')).toBe('true')
    expect((await screen.findByRole('alert')).textContent).toMatch(/user name and password/)

    await user.click(screen.getByRole('button', { name: 'Connect' }))
    const token = screen.getByLabelText('Owner token')
    await vi.waitFor(() => expect(token.getAttribute('aria-invalid')).toBe('true'))
    expect(screen.getByRole('alert').textContent).toMatch(/didn’t accept this token/)
    expect(address.getAttribute('aria-invalid')).toBe('false')
    expect((screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement).disabled).toBe(
      false,
    )
  })

  it('disables the form while the host checks', async () => {
    const user = userEvent.setup()
    const { bridge } = fakeBridge()
    let finish: (r: ConnectResult) => void = () => {}
    bridge.connectRemote.mockImplementationOnce(
      () =>
        new Promise<ConnectResult>((resolve) => {
          finish = resolve
        }),
    )
    render(<Splash bridge={bridge} initialView="connect" />)
    await user.type(await screen.findByLabelText('Address'), 'mawl.example.com')
    await user.type(screen.getByLabelText('Owner token'), TOKEN)
    await user.click(screen.getByRole('button', { name: 'Connect' }))
    const checking = await screen.findByRole('button', { name: 'Checking…' })
    expect((checking as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText('Address') as HTMLInputElement).disabled).toBe(true)
    await act(async () => finish({ ok: false, error: { kind: 'store' } }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/couldn’t save/)
  })

  it('warns when the address is not encrypted', async () => {
    const user = userEvent.setup()
    const { bridge } = fakeBridge()
    render(<Splash bridge={bridge} initialView="connect" />)
    await user.type(await screen.findByLabelText('Address'), 'http://192.168.1.20:7420')
    expect(screen.getByText(/isn’t encrypted/)).toBeTruthy()
  })

  it('goes back to the app on Cancel', async () => {
    const user = userEvent.setup()
    const { bridge } = fakeBridge({ status: { phase: 'ready' } })
    render(<Splash bridge={bridge} initialView="connect" />)
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    await vi.waitFor(() => expect(bridge.enterApp).toHaveBeenCalledTimes(1))
  })

  it('can be opened from the failed screen', async () => {
    const user = userEvent.setup()
    const { bridge } = fakeBridge({
      status: { phase: 'failed', reason: { kind: 'exited', code: 1 } },
    })
    render(<Splash bridge={bridge} />)
    await user.click(await screen.findByRole('button', { name: 'Connect to a remote Mawl' }))
    expect(await screen.findByRole('heading', { name: 'Connect to a remote Mawl' })).toBeTruthy()
  })

  it('offers this PC’s Mawl when a remote is in use', async () => {
    const user = userEvent.setup()
    const { bridge } = fakeBridge({ target: REMOTE })
    render(<Splash bridge={bridge} initialView="connect" />)
    expect(await screen.findByText(/Now showing mawl\.example\.com/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Use this PC’s Mawl' }))
    expect(bridge.switchToLocal).toHaveBeenCalledTimes(1)
  })
})
