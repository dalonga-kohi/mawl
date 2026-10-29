import { render, screen } from '@testing-library/react'
import { MotionConfig } from 'motion/react'
import { describe, expect, it, vi } from 'vitest'
import { OrbStage, WAKE_MS } from './Stage.tsx'

const orbState = (container: HTMLElement) =>
  container.querySelector('svg.mawl')?.getAttribute('data-state')

const beads = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-bead]')].map((b) => b.getAttribute('data-state'))

describe('the orb stage', () => {
  it('draws the real progress as a ring with three glyph beads', () => {
    const { container } = render(
      <OrbStage
        mascot="working"
        mode="progress"
        progress={{ done: 1, active: true, label: 'Starting the Mawl server' }}
      />,
    )
    const bar = screen.getByRole('progressbar', { name: 'Starting Mawl' })
    expect(bar.getAttribute('aria-valuenow')).toBe('1')
    expect(bar.getAttribute('aria-valuemax')).toBe('3')
    expect(bar.getAttribute('aria-valuetext')).toBe('Starting the Mawl server')
    expect(beads(container)).toEqual(['done', 'active', 'todo'])
    expect(
      [...container.querySelectorAll('[data-bead]')].map((b) => b.getAttribute('data-bead')),
    ).toEqual(['Database', 'Server', 'Ready'])
  })

  it('opens its eyes from sleepy brackets before the first step shows', async () => {
    const { container } = render(
      <OrbStage
        mascot="thinking"
        mode="progress"
        progress={{ done: 0, active: true, label: 'Starting the database' }}
      />,
    )
    expect(orbState(container)).toBe('sleepy')
    await vi.waitFor(() => expect(orbState(container)).toBe('thinking'), {
      timeout: WAKE_MS + 1500,
    })
  })

  it('skips the wake-up and holds still under reduced motion', () => {
    const { container } = render(
      <MotionConfig reducedMotion="always">
        <OrbStage
          mascot="thinking"
          mode="progress"
          progress={{ done: 0, active: true, label: 'Starting the database' }}
        />
      </MotionConfig>,
    )
    expect(orbState(container)).toBe('thinking')
    expect(container.querySelector('svg.mawl')?.classList.contains('is-still')).toBe(true)
  })

  it('dims the ring on a failure and keeps the orb in its oops pose', () => {
    const { container } = render(<OrbStage mascot="oops" mode="failed" />)
    expect(container.querySelector('[data-stage]')?.getAttribute('data-mode')).toBe('failed')
    expect(orbState(container)).toBe('oops')
    // The ring stays as a dimmed outline, with no progress to report.
    expect(beads(container)).toEqual(['todo', 'todo', 'todo'])
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('pulses the ring and shows the try number while restarting', () => {
    const { container } = render(
      <OrbStage
        mascot="thinking"
        mode="retry"
        progress={{ done: 0, active: true, label: 'Starting it again' }}
        retry={{ attempt: 2, of: 5 }}
      />,
    )
    expect(container.querySelector('[data-stage]')?.getAttribute('data-mode')).toBe('retry')
    expect(screen.getByText('2 of 5')).toBeTruthy()
  })

  it('shows only the orb on a calm screen', () => {
    const { container } = render(<OrbStage mascot="sleepy" mode="calm" />)
    expect(container.querySelectorAll('[data-bead]')).toHaveLength(0)
    expect(orbState(container)).toBe('sleepy')
  })
})
