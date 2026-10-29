import { afterEach, describe, expect, it, vi } from 'vitest'

const win = vi.hoisted(() => ({
  minimize: vi.fn(async () => {}),
  toggleMaximize: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  isMaximized: vi.fn(async () => false),
  isFocused: vi.fn(async () => true),
  onResized: vi.fn(async (_h: () => void) => () => {}),
  onFocusChanged: vi.fn(async (_h: (e: { payload: boolean }) => void) => () => {}),
}))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => win }))

import { hostWindowControls } from './window-controls.ts'

afterEach(() => {
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
  vi.clearAllMocks()
})

describe('hostWindowControls', () => {
  it('is null in a plain browser', () => {
    expect(hostWindowControls()).toBeNull()
  })

  it('drives the Tauri window inside the desktop app', async () => {
    Object.assign(window, { __TAURI_INTERNALS__: {} })
    const c = hostWindowControls()
    expect(c).not.toBeNull()
    await c?.minimize()
    await c?.toggleMaximize()
    await c?.close()
    expect(win.minimize).toHaveBeenCalledOnce()
    expect(win.toggleMaximize).toHaveBeenCalledOnce()
    expect(win.close).toHaveBeenCalledOnce()
  })

  it('reports maximized state again after every resize', async () => {
    Object.assign(window, { __TAURI_INTERNALS__: {} })
    const seen: boolean[] = []
    let resized: () => void = () => {}
    win.onResized.mockImplementation(async (h) => {
      resized = h
      return () => {}
    })
    win.isMaximized.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    await hostWindowControls()?.watch({ onMaximized: (m) => seen.push(m), onFocus: () => {} })
    resized()
    await vi.waitFor(() => expect(seen).toEqual([false, true]))
  })

  it('reports focus changes and stops listening on cleanup', async () => {
    Object.assign(window, { __TAURI_INTERNALS__: {} })
    const seen: boolean[] = []
    const off = vi.fn()
    let focus: (e: { payload: boolean }) => void = () => {}
    win.onFocusChanged.mockImplementation(async (h) => {
      focus = h
      return off
    })
    const stop = await hostWindowControls()?.watch({
      onMaximized: () => {},
      onFocus: (f) => seen.push(f),
    })
    focus({ payload: false })
    await vi.waitFor(() => expect(seen).toEqual([true, false]))
    stop?.()
    expect(off).toHaveBeenCalled()
  })
})
