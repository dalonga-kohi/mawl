import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WindowControls } from '../shell/window-controls.ts'
import { SplashFrame } from './SplashFrame.tsx'

const controls: WindowControls = {
  minimize: vi.fn(async () => {}),
  toggleMaximize: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  watch: vi.fn(async () => () => {}),
}

afterEach(() => document.documentElement.removeAttribute('data-titlebar'))

describe('SplashFrame', () => {
  it('puts the window title bar above the splash in the desktop app', () => {
    render(
      <SplashFrame controls={controls}>
        <main>Splash</main>
      </SplashFrame>,
    )
    expect(screen.getByRole('region', { name: 'Title bar' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
    expect(screen.getByRole('main')).toBeTruthy()
  })

  it('shows only the splash when there is no host window', () => {
    render(
      <SplashFrame controls={null}>
        <main>Splash</main>
      </SplashFrame>,
    )
    expect(screen.queryByRole('region', { name: 'Title bar' })).toBeNull()
    expect(screen.getByRole('main')).toBeTruthy()
  })
})
