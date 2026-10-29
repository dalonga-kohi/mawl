import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const win = vi.hoisted(() => ({
  minimize: vi.fn(async () => {}),
  toggleMaximize: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  isMaximized: vi.fn(async () => false),
  isFocused: vi.fn(async () => true),
  onResized: vi.fn(async () => () => {}),
  onFocusChanged: vi.fn(async () => () => {}),
}))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => win }))

import { OwnerTokenGate } from './OwnerTokenGate.tsx'

afterEach(() => {
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
  document.documentElement.removeAttribute('data-titlebar')
  sessionStorage.clear()
})

const gate = (launch?: string) =>
  render(
    <OwnerTokenGate
      storage={sessionStorage}
      verify={async () => 'unauthorized'}
      {...(launch ? { launch } : {})}
    >
      {() => <p>App</p>}
    </OwnerTokenGate>,
  )

describe('OwnerTokenGate on the frameless desktop window', () => {
  it('keeps the window title bar above its own screens, so the window can still be moved and closed', async () => {
    Object.assign(window, { __TAURI_INTERNALS__: {} })
    gate()
    expect(await screen.findByRole('heading', { name: 'Enter your owner token' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Title bar' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
  })

  it('adds no bar of its own once the app shows (the shell brings its own)', () => {
    Object.assign(window, { __TAURI_INTERNALS__: {} })
    gate('launch-token')
    expect(screen.getByText('App')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Title bar' })).toBeNull()
  })

  it('shows no bar in a browser', async () => {
    gate()
    await screen.findByRole('heading', { name: 'Enter your owner token' })
    expect(screen.queryByRole('region', { name: 'Title bar' })).toBeNull()
  })
})
