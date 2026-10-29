import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TitleBar } from './TitleBar.tsx'
import type { WindowControls, WindowWatch } from './window-controls.ts'

function fakeControls() {
  let watcher: WindowWatch = { onMaximized: () => {}, onFocus: () => {} }
  const stop = vi.fn()
  const controls: WindowControls = {
    minimize: vi.fn(async () => {}),
    toggleMaximize: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    watch: vi.fn(async (w) => {
      watcher = w
      return stop
    }),
  }
  return { controls, stop, emit: () => watcher }
}

afterEach(() => document.documentElement.removeAttribute('data-titlebar'))

describe('TitleBar', () => {
  it('minimizes, maximizes and closes the window from its three buttons', async () => {
    const { controls } = fakeControls()
    render(<TitleBar controls={controls} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Minimize' }))
    await user.click(screen.getByRole('button', { name: 'Maximize' }))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(controls.minimize).toHaveBeenCalledOnce()
    expect(controls.toggleMaximize).toHaveBeenCalledOnce()
    expect(controls.close).toHaveBeenCalledOnce()
  })

  it('swaps Maximize for Restore while the window is maximized', async () => {
    const f = fakeControls()
    render(<TitleBar controls={f.controls} />)
    await vi.waitFor(() => expect(f.controls.watch).toHaveBeenCalled())
    act(() => f.emit().onMaximized(true))
    expect(screen.getByRole('button', { name: 'Restore' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Maximize' })).toBeNull()
    act(() => f.emit().onMaximized(false))
    expect(screen.getByRole('button', { name: 'Maximize' })).toBeTruthy()
  })

  it('dims while the window is not focused', async () => {
    const f = fakeControls()
    render(<TitleBar controls={f.controls} />)
    await vi.waitFor(() => expect(f.controls.watch).toHaveBeenCalled())
    const bar = screen.getByRole('region', { name: 'Title bar' })
    act(() => f.emit().onFocus(false))
    expect(bar.getAttribute('data-focused')).toBe('false')
    act(() => f.emit().onFocus(true))
    expect(bar.getAttribute('data-focused')).toBe('true')
  })

  it('is a drag region around the app items, and the items stay clickable', async () => {
    const onClick = vi.fn()
    render(
      <TitleBar controls={fakeControls().controls}>
        <button type="button" onClick={onClick}>
          Item
        </button>
      </TitleBar>,
    )
    expect(
      screen.getByRole('region', { name: 'Title bar' }).hasAttribute('data-tauri-drag-region'),
    ).toBe(true)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Item' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('reserves its height for the layout and stops watching when removed', async () => {
    const f = fakeControls()
    const { unmount } = render(<TitleBar controls={f.controls} />)
    expect(document.documentElement.hasAttribute('data-titlebar')).toBe(true)
    await vi.waitFor(() => expect(f.controls.watch).toHaveBeenCalled())
    unmount()
    expect(document.documentElement.hasAttribute('data-titlebar')).toBe(false)
    await vi.waitFor(() => expect(f.stop).toHaveBeenCalled())
  })
})
