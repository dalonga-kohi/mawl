import { render, screen } from '@testing-library/react'
import { MotionConfig, MotionGlobalConfig } from 'motion/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { CLAIM_WAIT_MS, EntryHandoff, flightTo, useEntryTarget } from './entry.tsx'

// The hand-off's timing is its own (the claim wait); Motion's tweens finish at once here.
beforeAll(() => {
  MotionGlobalConfig.skipAnimations = true
})
afterAll(() => {
  MotionGlobalConfig.skipAnimations = false
})

const curtain = () => document.querySelector('[data-entry-curtain]')

function Landing() {
  const target = useEntryTarget('teal', 'idle')
  return (
    <div ref={target.ref} data-testid="landing-orb" style={{ opacity: target.hidden ? 0 : 1 }}>
      orb
    </div>
  )
}

describe('the orb hand-off into the app', () => {
  it('moves the orb onto the landing orb: centre to centre, scaled to its size', () => {
    expect(
      flightTo(
        { left: 656, top: 386, width: 128, height: 128 },
        { left: 600, top: 200, width: 120, height: 120 },
      ),
    ).toEqual({ x: -60, y: -190, scale: 120 / 128 })
    expect(
      flightTo({ left: 0, top: 0, width: 0, height: 0 }, { left: 10, top: 10, width: 4, height: 4 })
        .scale,
    ).toBe(1)
  })

  it('shows the app at once when nothing is handed off', () => {
    render(
      <EntryHandoff from={undefined}>
        <Landing />
      </EntryHandoff>,
    )
    expect(curtain()).toBeNull()
    expect(screen.getByTestId('landing-orb').style.opacity).toBe('1')
  })

  it('covers the app with the orb, flies it to the landing, then shows the landing orb', async () => {
    render(
      <EntryHandoff from="centre">
        <Landing />
      </EntryHandoff>,
    )
    // The first frame is the splash's last one: the orb alone, happy, the landing orb hidden.
    expect(curtain()).not.toBeNull()
    expect(screen.getByTestId('landing-orb').style.opacity).toBe('0')
    await vi.waitFor(() => expect(curtain()).toBeNull(), { timeout: CLAIM_WAIT_MS - 200 })
    expect(screen.getByTestId('landing-orb').style.opacity).toBe('1')
  })

  it('fades in place when no landing claims the orb', async () => {
    render(
      <EntryHandoff from={{ x: 100, y: 100, size: 88 }}>
        <p>Settings</p>
      </EntryHandoff>,
    )
    expect(curtain()).not.toBeNull()
    await vi.waitFor(() => expect(curtain()).toBeNull(), { timeout: CLAIM_WAIT_MS + 1500 })
    expect(screen.getByText('Settings')).toBeTruthy()
  })

  it('never makes the owner wait on the flight under reduced motion', async () => {
    render(
      <MotionConfig reducedMotion="always">
        <EntryHandoff from="centre">
          <Landing />
        </EntryHandoff>
      </MotionConfig>,
    )
    await vi.waitFor(() => expect(curtain()).toBeNull(), { timeout: 500 })
  })

  it('lets clicks through while it covers the app', () => {
    render(
      <EntryHandoff from="centre">
        <p>App</p>
      </EntryHandoff>,
    )
    expect(curtain()?.className).toContain('pointer-events-none')
  })
})
