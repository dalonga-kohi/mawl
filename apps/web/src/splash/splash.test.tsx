import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MotionGlobalConfig } from 'motion/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { HostBridge } from './bridge.ts'
import { READY_HOLD_MS, Splash } from './Splash.tsx'
import type { Status } from './status.ts'

function fakeBridge(first: Status) {
  let emit: (s: Status) => void = () => {}
  const bridge = {
    status: vi.fn(async () => first),
    onStatus: vi.fn(async (handler: (s: Status) => void) => {
      emit = handler
      return () => {}
    }),
    diagnostics: vi.fn(async () => 'Mawl diagnostics\n[host] server exited with code 1'),
    retry: vi.fn(async () => {}),
    quit: vi.fn(async () => {}),
    enterApp: vi.fn(async () => {}),
    shown: vi.fn(async () => {}),
    target: vi.fn(async () => ({ kind: 'local' }) as const),
    checkRemote: vi.fn(async () => 'ready' as const),
    connectRemote: vi.fn(async () => ({ ok: true }) as const),
    switchToLocal: vi.fn(async () => ({ ok: true }) as const),
  } satisfies HostBridge
  return { bridge, emit: (s: Status) => act(() => emit(s)) }
}

const FAILED: Status = { phase: 'failed', reason: { kind: 'exited', code: 1 } }

// These tests are about what the splash says and does, not how it moves. With animations on, the
// old title waits for a Motion exit animation before the new one mounts, and on a loaded CI runner
// that exit outlived even a 15 s wait. Skipping animations finishes every enter and exit at once;
// the timers the splash itself sets (the ready hold) still run in real time.
beforeAll(() => {
  MotionGlobalConfig.skipAnimations = true
})
afterAll(() => {
  MotionGlobalConfig.skipAnimations = false
})

describe('the desktop splash', () => {
  it('shows the real boot stage and moves the track as the host reports progress', async () => {
    const { bridge, emit } = fakeBridge({ phase: 'starting', stage: 'database' })
    render(<Splash bridge={bridge} />)
    expect(await screen.findByRole('heading', { name: 'Waking up' })).toBeTruthy()
    const track = screen.getByRole('progressbar', { name: 'Starting Mawl' })
    expect(track.getAttribute('aria-valuenow')).toBe('0')
    expect(track.getAttribute('aria-valuetext')).toBe('Starting the database')

    emit({ phase: 'starting', stage: 'server' })
    expect(await screen.findByRole('heading', { name: 'Almost there' })).toBeTruthy()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('1')
    expect(screen.queryByRole('button')).toBeNull()
  })

  describe('when the server is ready', () => {
    // Real time on purpose: Motion keeps the first requestAnimationFrame it sees, so faking timers
    // here would freeze every animation in the tests that follow.

    it('holds "Ready" for a beat, then hands the window to the app', async () => {
      const { bridge, emit } = fakeBridge({ phase: 'starting', stage: 'server' })
      render(<Splash bridge={bridge} />)
      await screen.findByRole('heading', { name: 'Almost there' })
      emit({ phase: 'ready' })
      expect(await screen.findByRole('heading', { name: 'Ready' })).toBeTruthy()
      expect(bridge.enterApp).not.toHaveBeenCalled()
      await vi.waitFor(() => expect(bridge.enterApp).toHaveBeenCalledTimes(1), { timeout: 5000 })
    })

    it('stays when the server falls over before the fade ends', async () => {
      const { bridge, emit } = fakeBridge({ phase: 'ready' })
      render(<Splash bridge={bridge} />)
      await screen.findByRole('heading', { name: 'Ready' })
      emit({ phase: 'restarting', attempt: 1, reason: { kind: 'unhealthy' }, retry_in_ms: 1000 })
      await act(() => new Promise((r) => setTimeout(r, READY_HOLD_MS + 400)))
      expect(bridge.enterApp).not.toHaveBeenCalled()
      expect(screen.getByRole('heading', { name: 'Restarting' })).toBeTruthy()
    })
  })

  it('explains a restart and which try it is', async () => {
    const { bridge } = fakeBridge({
      phase: 'restarting',
      attempt: 2,
      reason: { kind: 'exited', code: 1 },
      retry_in_ms: 2000,
    })
    render(<Splash bridge={bridge} />)
    expect(await screen.findByRole('heading', { name: 'Restarting' })).toBeTruthy()
    expect(screen.getByText(/stopped unexpectedly.*try 2 of 5/)).toBeTruthy()
  })

  it('offers try again, copy diagnostics and quit when the server failed for good', async () => {
    const user = userEvent.setup()
    const { bridge } = fakeBridge(FAILED)
    render(<Splash bridge={bridge} />)
    expect(await screen.findByRole('heading', { name: 'Mawl can’t start' })).toBeTruthy()
    expect(screen.queryByRole('progressbar')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(bridge.retry).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Quit Mawl' }))
    expect(bridge.quit).toHaveBeenCalledTimes(1)
  })

  it('says so when the host refuses Try again or Quit', async () => {
    const user = userEvent.setup()
    const { bridge } = fakeBridge(FAILED)
    bridge.retry.mockRejectedValueOnce(new Error('no'))
    bridge.quit.mockRejectedValueOnce(new Error('no'))
    render(<Splash bridge={bridge} />)
    await user.click(await screen.findByRole('button', { name: 'Try again' }))
    expect((await screen.findByRole('alert')).textContent).toContain('couldn’t restart the server')
    await user.click(screen.getByRole('button', { name: 'Quit Mawl' }))
    expect((await screen.findByRole('alert')).textContent).toContain('couldn’t quit')
  })

  it('copies the diagnostics and confirms it', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn(async () => {})
    const { bridge } = fakeBridge(FAILED)
    render(<Splash bridge={bridge} clipboard={{ writeText }} />)
    await user.click(await screen.findByRole('button', { name: 'Copy diagnostics' }))
    expect(writeText).toHaveBeenCalledWith('Mawl diagnostics\n[host] server exited with code 1')
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy()
    expect(screen.getByText('Diagnostics copied. Paste them into your report.')).toBeTruthy()
  })

  it('says so when the clipboard refuses', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn(async () => {
      throw new Error('denied')
    })
    const { bridge } = fakeBridge(FAILED)
    render(<Splash bridge={bridge} clipboard={{ writeText }} />)
    await user.click(await screen.findByRole('button', { name: 'Copy diagnostics' }))
    expect(await screen.findByText('Couldn’t reach the clipboard. Try again.')).toBeTruthy()
  })

  it('tells the window it can show once it painted', async () => {
    const { bridge } = fakeBridge({ phase: 'starting', stage: 'database' })
    render(<Splash bridge={bridge} />)
    await vi.waitFor(() => expect(bridge.shown).toHaveBeenCalled())
  })
})
