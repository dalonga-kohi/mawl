import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConnectResult, HostBridge } from './bridge.ts'
import {
  type ConnectError,
  connectErrorCopy,
  describeRemote,
  HEALTHS,
  hostOf,
  parseConnectError,
  parseHealth,
  parseHostAppearance,
  parseTarget,
  type RemoteHealth,
  type Target,
} from './remote.ts'
import { Splash } from './Splash.tsx'
import { initialViewFrom } from './setup.ts'
import type { Status } from './status.ts'

const TOKEN = 'remote-owner-token_0123456789abcdefXYZ'
const REMOTE: Target = { kind: 'remote', origin: 'https://mawl.example.com/' }

function fakeBridge({
  target = { kind: 'local' } as Target,
  status = { phase: 'ready' } as Status,
  checks = ['ready'] as RemoteHealth[],
}: {
  target?: Target
  status?: Status
  checks?: RemoteHealth[]
} = {}) {
  const queue = [...checks]
  return {
    status: vi.fn(async () => status),
    onStatus: vi.fn(async () => () => {}),
    diagnostics: vi.fn(async () => 'diagnostics'),
    retry: vi.fn(async () => {}),
    quit: vi.fn(async () => {}),
    enterApp: vi.fn(async () => {}),
    shown: vi.fn(async () => {}),
    target: vi.fn(async () => target),
    checkRemote: vi.fn(async (): Promise<RemoteHealth> => queue.shift() ?? 'unreachable'),
    connectRemote: vi.fn(
      async (_url: string, _token: string): Promise<ConnectResult> => ({ ok: true }),
    ),
    switchToLocal: vi.fn(async (): Promise<ConnectResult> => ({ ok: true })),
  } satisfies HostBridge
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('address and token helpers at the edges', () => {
  it('hostOf keeps the port, brackets an IPv6 literal and survives junk', () => {
    expect(hostOf('https://mawl.example.com/')).toBe('mawl.example.com')
    expect(hostOf('http://192.168.1.20:7420/')).toBe('192.168.1.20:7420')
    expect(hostOf('https://[::1]:7420/')).toBe('[::1]:7420')
    expect(hostOf('not a url')).toBe('not a url')
    expect(hostOf('')).toBe('')
    expect(hostOf('x'.repeat(100_000))).toHaveLength(100_000)
  })

  it('every host answer has copy that names the address and never a token', () => {
    for (const health of HEALTHS.filter((h) => h !== 'ready')) {
      const text = describeRemote(health, 'mawl.example.com')
      expect(text.length).toBeGreaterThan(10)
      expect(text).toContain('mawl.example.com')
      expect(text).not.toContain(TOKEN)
    }
  })

  it('every error the host can send maps to a field and plain copy', () => {
    const errors: ConnectError[] = [
      ...(
        [
          'empty',
          'too_long',
          'not_a_url',
          'scheme',
          'insecure',
          'user_info',
          'no_host',
          'not_an_origin',
        ] as const
      ).map((reason) => ({ kind: 'url' as const, reason })),
      ...(['empty', 'length', 'characters'] as const).map((reason) => ({
        kind: 'token' as const,
        reason,
      })),
      ...HEALTHS.map((health) => ({ kind: 'remote' as const, health })),
      { kind: 'store' },
    ]
    const seen = new Set<string>()
    for (const error of errors) {
      const copy = connectErrorCopy(error)
      expect(['url', 'token', 'form']).toContain(copy.field)
      expect(copy.message.length).toBeGreaterThan(10)
      expect(copy.message).not.toMatch(/undefined|\[object|null/)
      seen.add(`${copy.field}:${copy.message}`)
    }
    // Token-specific reasons must not share one line of copy.
    expect(
      new Set(errors.filter((e) => e.kind === 'token').map((e) => connectErrorCopy(e).message))
        .size,
    ).toBe(3)
  })

  it('anything the host sends that is not ours is a store error, not a crash', () => {
    for (const junk of [
      null,
      undefined,
      42,
      'a string',
      [],
      {},
      { kind: 'url' },
      { kind: 'url', reason: 'surprise' },
      { kind: 'token', reason: ['empty'] },
      { kind: 'remote', health: 'on_fire' },
      { kind: 'url', reason: 'scheme', token: TOKEN },
    ]) {
      const parsed = parseConnectError(junk)
      expect(['url', 'token', 'remote', 'store']).toContain(parsed.kind)
      expect(JSON.stringify(parsed)).not.toContain(TOKEN)
    }
    expect(parseConnectError({ kind: 'url', reason: 'surprise' })).toEqual({ kind: 'store' })
    expect(parseHealth(null)).toBe('unreachable')
    expect(parseHealth('READY')).toBe('unreachable')
  })

  it('parseTarget and parseHostAppearance reject malformed shapes', () => {
    expect(parseTarget(null)).toEqual({ kind: 'local' })
    expect(parseTarget({ kind: 'remote', origin: '' })).toEqual({ kind: 'local' })
    expect(parseTarget({ kind: 'remote', origin: 42 })).toEqual({ kind: 'local' })
    expect(parseTarget({ kind: 'cloud', origin: 'https://x' })).toEqual({ kind: 'local' })

    const ok = { theme: 'dark', accent: '#AABBCC', reduceMotion: true }
    expect(parseHostAppearance(ok)).toEqual(ok)
    expect(parseHostAppearance({ ...ok, accent: null })).toEqual({ ...ok, accent: null })
    for (const bad of [
      { ...ok, accent: '#ABC' },
      { ...ok, accent: 'AABBCC' },
      { ...ok, accent: '#AABBCCDD' },
      { ...ok, accent: 'red; background:url(x)' },
      { ...ok, theme: 'sepia' },
      { ...ok, reduceMotion: 'true' },
      { theme: 'dark' },
      null,
      'dark',
    ]) {
      expect(parseHostAppearance(bad)).toBeNull()
    }
  })

  it('initialViewFrom opens the form only on a connect key', () => {
    expect(initialViewFrom('?connect')).toBe('connect')
    expect(initialViewFrom('?connect=1')).toBe('connect')
    expect(initialViewFrom('?a=1&connect')).toBe('connect')
    expect(initialViewFrom('')).toBe('main')
    expect(initialViewFrom('?')).toBe('main')
    expect(initialViewFrom('?Connect')).toBe('main')
    expect(initialViewFrom('?x=connect')).toBe('main')
    expect(initialViewFrom('?disconnect')).toBe('main')
  })
})

describe('the splash flows under failure', () => {
  const fillAndSubmit = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(await screen.findByLabelText('Address'), 'https://mawl.example.com')
    await user.type(screen.getByLabelText('Owner token'), TOKEN)
    await user.click(screen.getByRole('button', { name: 'Connect' }))
  }

  it('the token never shows in the page, an error line or the console after a refusal', async () => {
    const logs = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'info').mockImplementation(() => {}),
    ]
    const user = userEvent.setup()
    const bridge = fakeBridge()
    bridge.connectRemote.mockResolvedValueOnce({
      ok: false,
      error: { kind: 'remote', health: 'token_refused' },
    })
    const { container } = render(<Splash bridge={bridge} initialView="connect" />)
    await fillAndSubmit(user)
    await screen.findByRole('alert')
    expect(container.textContent).not.toContain(TOKEN)
    const token = screen.getByLabelText('Owner token') as HTMLInputElement
    expect(token.type).toBe('password')
    // The token is also not in any attribute (title, aria, data) or in the address field.
    expect(container.innerHTML.replace(/value="[^"]*"/g, '')).not.toContain(TOKEN)
    expect((screen.getByLabelText('Address') as HTMLInputElement).value).not.toContain(TOKEN)
    for (const spy of logs) expect(JSON.stringify(spy.mock.calls)).not.toContain(TOKEN)
    expect(window.location.href).not.toContain(TOKEN)
    expect(JSON.stringify({ ...window.localStorage })).not.toContain(TOKEN)
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain(TOKEN)
  })

  it('a pasted token reaches the host as typed, with its surroundings left to the host', async () => {
    const user = userEvent.setup()
    const bridge = fakeBridge()
    render(<Splash bridge={bridge} initialView="connect" />)
    const address = await screen.findByLabelText('Address')
    await user.type(address, '  https://mawl.example.com/  ')
    const token = screen.getByLabelText('Owner token')
    fireEvent.change(token, { target: { value: `  ${TOKEN}\n` } })
    await user.click(screen.getByRole('button', { name: 'Connect' }))
    expect(bridge.connectRemote).toHaveBeenCalledTimes(1)
    const [url, sent] = bridge.connectRemote.mock.calls[0] ?? []
    expect(url?.trim()).toBe('https://mawl.example.com/')
    expect(sent?.trim()).toBe(TOKEN)
  })

  it('a huge address is passed to the host in one call and the UI stays responsive', async () => {
    const user = userEvent.setup()
    const bridge = fakeBridge()
    bridge.connectRemote.mockResolvedValueOnce({
      ok: false,
      error: { kind: 'url', reason: 'too_long' },
    })
    render(<Splash bridge={bridge} initialView="connect" />)
    fireEvent.change(await screen.findByLabelText('Address'), {
      target: { value: `https://${'a'.repeat(100_000)}.example` },
    })
    fireEvent.change(screen.getByLabelText('Owner token'), { target: { value: TOKEN } })
    await user.click(screen.getByRole('button', { name: 'Connect' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/too long/)
    expect(bridge.connectRemote).toHaveBeenCalledTimes(1)
  })

  it('Enter in the token field submits once, even when pressed twice quickly', async () => {
    const user = userEvent.setup()
    const bridge = fakeBridge()
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
    const form = screen.getByLabelText('Owner token').closest('form') as HTMLFormElement
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(bridge.connectRemote).toHaveBeenCalledTimes(1)
    await act(async () => finish({ ok: false, error: { kind: 'store' } }))
    await screen.findByRole('alert')
  })

  it('a host call that rejects (instead of answering) leaves the form usable', async () => {
    // The real bridge turns a rejection into { ok: false }, but a rejection that reaches the form
    // must not leave it disabled and silent forever.
    const user = userEvent.setup()
    const bridge = fakeBridge()
    bridge.connectRemote.mockRejectedValueOnce(new Error('ipc closed'))
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    render(<Splash bridge={bridge} initialView="connect" />)
    await fillAndSubmit(user)
    await vi.waitFor(() =>
      expect(
        (screen.getByRole('button', { name: /Connect|Checking/ }) as HTMLButtonElement).disabled,
      ).toBe(false),
    )
    expect(screen.getByRole('alert')).toBeTruthy()
    process.off('unhandledRejection', unhandled)
  })

  it('switching to this PC that rejects leaves the remote screen usable', async () => {
    const user = userEvent.setup()
    const bridge = fakeBridge({ target: REMOTE, checks: ['token_refused'] })
    bridge.switchToLocal.mockRejectedValueOnce(new Error('ipc closed'))
    render(<Splash bridge={bridge} />)
    await user.click(await screen.findByRole('button', { name: 'Use this PC’s Mawl' }))
    await vi.waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Use this PC’s Mawl' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    )
  })

  it('switching to this PC from the form that rejects says so and re-enables the form', async () => {
    const user = userEvent.setup()
    const bridge = fakeBridge({ target: REMOTE })
    bridge.switchToLocal.mockRejectedValueOnce(new Error('ipc closed'))
    render(<Splash bridge={bridge} initialView="connect" />)
    await user.click(await screen.findByRole('button', { name: 'Use this PC’s Mawl' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/couldn’t save the connection/)
    expect((screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement).disabled).toBe(
      false,
    )
  })

  it('a failed switch to this PC says so and offers the button again', async () => {
    const user = userEvent.setup()
    const bridge = fakeBridge({ target: REMOTE, checks: ['unreachable'] })
    bridge.switchToLocal.mockResolvedValueOnce({ ok: false, error: { kind: 'store' } })
    render(<Splash bridge={bridge} />)
    await user.click(await screen.findByRole('button', { name: 'Use this PC’s Mawl' }))
    expect(await screen.findByText(/couldn’t save the connection/)).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Use this PC’s Mawl' }) as HTMLButtonElement).disabled,
    ).toBe(false)
  })

  it('a remote check that rejects reads as unreachable', async () => {
    const bridge = fakeBridge({ target: REMOTE })
    bridge.checkRemote.mockRejectedValueOnce(new Error('ipc closed'))
    render(<Splash bridge={bridge} />)
    expect(await screen.findByText(/couldn’t reach mawl\.example\.com/)).toBeTruthy()
    expect(bridge.enterApp).not.toHaveBeenCalled()
  })

  it('a target call that rejects falls back to this PC', async () => {
    const bridge = fakeBridge({ status: { phase: 'ready' } })
    bridge.target.mockRejectedValueOnce(new Error('acl'))
    render(<Splash bridge={bridge} />)
    await vi.waitFor(() => expect(bridge.status).toHaveBeenCalled())
    expect(bridge.checkRemote).not.toHaveBeenCalled()
  })

  it('Try again during an unresolved check does not enter twice', async () => {
    const user = userEvent.setup()
    const bridge = fakeBridge({ target: REMOTE, checks: ['unreachable', 'ready', 'ready'] })
    render(<Splash bridge={bridge} />)
    const again = await screen.findByRole('button', { name: 'Try again' })
    await user.dblClick(again)
    await vi.waitFor(() => expect(bridge.enterApp).toHaveBeenCalled(), { timeout: 5000 })
    await new Promise((r) => setTimeout(r, 50))
    expect(bridge.enterApp).toHaveBeenCalledTimes(1)
  })

  it('every refusal of a remote check has its own, readable screen', async () => {
    for (const health of ['unreachable', 'not_mawl', 'token_refused', 'unhealthy'] as const) {
      const bridge = fakeBridge({ target: REMOTE, checks: [health] })
      const { unmount, container } = render(<Splash bridge={bridge} />)
      await screen.findByRole('heading', { name: 'Can’t reach your remote Mawl' })
      expect(container.textContent).toContain(describeRemote(health, 'mawl.example.com'))
      expect(bridge.enterApp).not.toHaveBeenCalled()
      unmount()
    }
  })

  it('Cancel from the form on a remote target goes back to the remote check, not the local app', async () => {
    const user = userEvent.setup()
    const bridge = fakeBridge({ target: REMOTE, checks: ['ready', 'unreachable'] })
    render(<Splash bridge={bridge} initialView="connect" />)
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    await vi.waitFor(() => expect(bridge.checkRemote).toHaveBeenCalled())
    expect(bridge.status).not.toHaveBeenCalled()
  })
})
