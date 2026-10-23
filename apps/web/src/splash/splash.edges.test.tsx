import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { HostBridge } from './bridge.ts'
import { Splash } from './Splash.tsx'
import { parseStatus, type Status, describe as view } from './status.ts'

const FAILED: Status = { phase: 'failed', reason: { kind: 'exited', code: 1 } }

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function bridgeWith(overrides: Partial<HostBridge> = {}) {
  let emit: ((s: Status) => void) | undefined
  const off = vi.fn()
  const bridge: HostBridge = {
    status: async () => ({ phase: 'starting', stage: 'database' }),
    onStatus: async (handler) => {
      emit = handler
      return off
    },
    diagnostics: async () => 'diag',
    retry: async () => {},
    quit: async () => {},
    enterApp: async () => {},
    shown: async () => {},
    target: async () => ({ kind: 'local' }),
    checkRemote: async () => 'ready',
    connectRemote: async () => ({ ok: true }),
    switchToLocal: async () => ({ ok: true }),
    ...overrides,
  }
  return {
    bridge,
    off,
    // The status view subscribes once the host said the target is this PC: wait for it.
    emit: async (s: Status) => {
      await vi.waitFor(() => expect(emit).toBeDefined())
      await act(() => emit?.(s))
    },
  }
}

describe('splash races and failure paths', () => {
  it('keeps a newer event when the initial status snapshot answers late', async () => {
    const snapshot = deferred<Status>()
    const { bridge, emit } = bridgeWith({ status: () => snapshot.promise })
    render(<Splash bridge={bridge} />)
    await vi.waitFor(() => expect(bridge.shown).toBeDefined())
    await emit({ phase: 'failed', reason: { kind: 'exited', code: 3 } })
    expect(await screen.findByRole('heading', { name: 'Mawl can’t start' })).toBeTruthy()
    // The snapshot was taken before the failure and arrives after it.
    await act(async () => snapshot.resolve({ phase: 'starting', stage: 'database' }))
    // Let the title cross-fade finish so a wrong state would show.
    await act(() => new Promise((r) => setTimeout(r, 500)))
    expect(screen.queryByRole('heading', { name: 'Waking up' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Mawl can’t start' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('unsubscribes when it unmounts before the subscription resolves', async () => {
    const sub = deferred<() => void>()
    const off = vi.fn()
    const onStatus = vi.fn(() => sub.promise)
    const { bridge } = bridgeWith({ onStatus })
    const { unmount } = render(<Splash bridge={bridge} />)
    await vi.waitFor(() => expect(onStatus).toHaveBeenCalled())
    unmount()
    await act(async () => sub.resolve(off))
    expect(off).toHaveBeenCalledTimes(1)
  })

  it('unsubscribes on unmount after subscribing', async () => {
    const { bridge, off } = bridgeWith()
    const { unmount } = render(<Splash bridge={bridge} />)
    await screen.findByRole('heading', { name: 'Waking up' })
    unmount()
    expect(off).toHaveBeenCalledTimes(1)
  })

  it('does not call enterApp after it unmounted during the ready hold', async () => {
    const enterApp = vi.fn(async () => {})
    const { bridge, emit } = bridgeWith({ enterApp })
    const { unmount } = render(<Splash bridge={bridge} />)
    await screen.findByRole('heading', { name: 'Waking up' })
    await emit({ phase: 'ready' })
    unmount()
    await act(() => new Promise((r) => setTimeout(r, 1200)))
    expect(enterApp).not.toHaveBeenCalled()
  })

  it('re-enables Try again when the retry command fails, without an unhandled rejection', async () => {
    const user = userEvent.setup()
    const retry = vi.fn(async () => {
      throw new Error('host said no')
    })
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      const { bridge } = bridgeWith({ status: async () => FAILED, retry })
      render(<Splash bridge={bridge} />)
      const button = await screen.findByRole('button', { name: 'Try again' })
      await user.click(button)
      await vi.waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
      await act(() => new Promise((r) => setTimeout(r, 20)))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it('re-enables the buttons when quitting fails', async () => {
    const user = userEvent.setup()
    const quit = vi.fn(async () => {
      throw new Error('cannot quit')
    })
    const { bridge } = bridgeWith({ status: async () => FAILED, quit })
    render(<Splash bridge={bridge} />)
    await user.click(await screen.findByRole('button', { name: 'Quit Mawl' }))
    await vi.waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Try again' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    )
  })

  it('reports a diagnostics command that fails as a clipboard problem and recovers', async () => {
    const user = userEvent.setup()
    const diagnostics = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('ipc'))
      .mockResolvedValueOnce('second try')
    const writeText = vi.fn(async () => {})
    const { bridge } = bridgeWith({ status: async () => FAILED, diagnostics })
    render(<Splash bridge={bridge} clipboard={{ writeText }} />)
    await user.click(await screen.findByRole('button', { name: 'Copy diagnostics' }))
    expect(await screen.findByText('Couldn’t reach the clipboard. Try again.')).toBeTruthy()
    expect(writeText).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Copy diagnostics' }))
    expect(await screen.findByText('Diagnostics copied. Paste them into your report.')).toBeTruthy()
    expect(writeText).toHaveBeenCalledWith('second try')
  })

  it('shows the error message when there is no clipboard at all', async () => {
    const user = userEvent.setup()
    const { bridge } = bridgeWith({ status: async () => FAILED })
    render(<Splash bridge={bridge} clipboard={undefined} />)
    // `clipboard` undefined falls back to navigator.clipboard, which jsdom lacks.
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    await user.click(await screen.findByRole('button', { name: 'Copy diagnostics' }))
    expect(await screen.findByText('Couldn’t reach the clipboard. Try again.')).toBeTruthy()
  })

  it('ignores a second click on Copy diagnostics while the first is in flight', async () => {
    const user = userEvent.setup()
    const gate = deferred<void>()
    const writeText = vi.fn(() => gate.promise)
    const { bridge } = bridgeWith({ status: async () => FAILED })
    render(<Splash bridge={bridge} clipboard={{ writeText }} />)
    const button = await screen.findByRole('button', { name: 'Copy diagnostics' })
    await user.click(button)
    await user.click(button)
    expect(writeText).toHaveBeenCalledTimes(1)
    await act(async () => gate.resolve())
  })

  it('leaves the failed screen when the host starts again', async () => {
    const { bridge, emit } = bridgeWith({ status: async () => FAILED })
    render(<Splash bridge={bridge} />)
    await screen.findByRole('button', { name: 'Try again' })
    await emit({ phase: 'starting', stage: 'database' })
    expect(await screen.findByRole('heading', { name: 'Waking up' })).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('exposes the failed screen actions in tab order', async () => {
    const user = userEvent.setup()
    const { bridge } = bridgeWith({ status: async () => FAILED })
    render(<Splash bridge={bridge} />)
    await screen.findByRole('button', { name: 'Try again' })
    await user.tab()
    expect(document.activeElement?.textContent).toBe('Try again')
    await user.tab()
    expect(document.activeElement?.textContent).toContain('Copy diagnostics')
    await user.tab()
    expect(document.activeElement?.textContent).toBe('Connect to a remote Mawl')
    await user.tab()
    expect(document.activeElement?.textContent).toBe('Quit Mawl')
  })
})

describe('status parsing and wording', () => {
  it('falls back to the starting screen for anything it does not know', () => {
    for (const bad of [
      null,
      undefined,
      'ready',
      42,
      {},
      { phase: 'exploded' },
      { phase: 'starting', stage: 'cloud' },
      { phase: 'restarting', attempt: 0, reason: { kind: 'unhealthy' }, retry_in_ms: null },
      { phase: 'restarting', attempt: 1.5, reason: { kind: 'unhealthy' }, retry_in_ms: null },
      { phase: 'restarting', attempt: 1, reason: { kind: 'nope' }, retry_in_ms: 5 },
      { phase: 'restarting', attempt: 1, reason: { kind: 'unhealthy' }, retry_in_ms: -1 },
      { phase: 'failed', reason: { kind: 'exited' } },
    ]) {
      expect(parseStatus(bad), JSON.stringify(bad)).toEqual({
        phase: 'starting',
        stage: 'database',
      })
    }
  })

  it('accepts what the Rust host serializes, including a killed process and no retry delay', () => {
    expect(parseStatus({ phase: 'failed', reason: { kind: 'exited', code: null } })).toEqual({
      phase: 'failed',
      reason: { kind: 'exited', code: null },
    })
    expect(
      parseStatus({ phase: 'failed', reason: { kind: 'exited', code: -1073741819 } }).phase,
    ).toBe('failed')
    expect(
      parseStatus({
        phase: 'restarting',
        attempt: 5,
        reason: { kind: 'boot_timeout' },
        retry_in_ms: null,
      }),
    ).toMatchObject({ phase: 'restarting', attempt: 5 })
  })

  it('never shows the restart counter or the retry button on the not-installed screen wrongly', () => {
    const v = view({ phase: 'failed', reason: { kind: 'not_installed' } })
    expect(v.failed).toBe(true)
    expect(v.detail).toMatch(/Reinstall/)
    expect(v.detail).not.toMatch(/restarted it/)
  })

  it('gives every reason its own plain sentence with no system words', () => {
    const kinds = [
      { kind: 'spawn_failed' },
      { kind: 'exited', code: null },
      { kind: 'unhealthy' },
      { kind: 'boot_timeout' },
      { kind: 'not_installed' },
    ] as const
    const seen = new Set<string>()
    for (const reason of kinds) {
      const d = view({ phase: 'failed', reason }).detail
      expect(d).not.toMatch(/sidecar|healthz|postgres|pid|exit code/i)
      seen.add(d)
    }
    expect(seen.size).toBe(kinds.length)
  })

  it('hides the progress track on the closing screens', () => {
    expect(view({ phase: 'stopping' }).done).toBeUndefined()
    expect(view({ phase: 'stopped' }).done).toBeUndefined()
  })
})
