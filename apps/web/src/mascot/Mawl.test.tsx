import { act, fireEvent, render } from '@testing-library/react'
import { MotionConfig } from 'motion/react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LifeClock } from './idle-life.ts'
import { HOP_MS, Mawl, POSES } from './Mawl.tsx'
import { MASCOT_STATES } from './states.ts'
import { WAYS } from './ways.ts'

const svgOf = (container: HTMLElement) => {
  const svg = container.querySelector('svg.mawl')
  if (!svg) throw new Error('no Mawl rendered')
  return svg as SVGSVGElement
}
const glyphs = (svg: SVGSVGElement) =>
  [...svg.querySelectorAll('[data-part="eye"]')].map((n) => n.getAttribute('data-glyph'))
const effects = (svg: SVGSVGElement) =>
  [...svg.querySelectorAll('[data-part^="fx-"]')].map((n) => n.getAttribute('data-part'))
const reduced = (ui: ReactElement) => <MotionConfig reducedMotion="always">{ui}</MotionConfig>

/** A clock on vitest's fake timers with a scripted random sequence, that tracks pending timers. */
function testClock(randoms: number[]) {
  let i = 0
  const pending = new Set<unknown>()
  const clock: LifeClock = {
    random: () => randoms[i++ % randoms.length] ?? 0,
    setTimeout: (fn, ms) => {
      const id = setTimeout(() => {
        pending.delete(id)
        fn()
      }, ms)
      pending.add(id)
      return id
    },
    clearTimeout: (id) => {
      pending.delete(id)
      clearTimeout(id as ReturnType<typeof setTimeout>)
    },
  }
  return { clock, pending }
}
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms))
function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  })
  act(() => void document.dispatchEvent(new Event('visibilitychange')))
}

describe('Mawl, the orb', () => {
  it('is decorative and reports its state', () => {
    const { container } = render(<Mawl state="thinking" />)
    const svg = svgOf(container)
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.getAttribute('data-state')).toBe('thinking')
  })

  it('rests idle, in lavender, by default', () => {
    const svg = svgOf(render(<Mawl />).container)
    expect(svg.getAttribute('data-state')).toBe('idle')
    expect(svg.getAttribute('data-way')).toBe('lavender')
  })

  it('draws one circle body', () => {
    const svg = svgOf(render(<Mawl size={160} />).container)
    expect(svg.querySelectorAll('circle[data-part="body"]')).toHaveLength(1)
  })

  it('shows the glyph eyes and the effect of each state', () => {
    for (const state of MASCOT_STATES) {
      const { container, unmount } = render(<Mawl state={state} size={160} />)
      const svg = svgOf(container)
      const pose = POSES[state]
      expect(glyphs(svg), state).toEqual([pose.l, pose.r])
      expect(effects(svg), state).toEqual(pose.fx ? [`fx-${pose.fx}`] : [])
      unmount()
    }
  })

  it('gives every state its own eyes', () => {
    expect(POSES.idle).toMatchObject({ l: 'bar', r: 'bar' })
    expect(POSES.listening).toMatchObject({ l: 'short', r: 'short' })
    expect(POSES.listening.look?.y).toBeGreaterThan(0)
    expect(POSES.thinking).toMatchObject({ l: 'ring', r: 'ring', fx: 'think' })
    expect(POSES.thinking.look?.x).toBeGreaterThan(0)
    expect(POSES.thinking.look?.y).toBeLessThan(0)
    expect(POSES.working).toMatchObject({ l: 'star', r: 'star' })
    expect(POSES.waiting).toMatchObject({ l: 'plus', r: 'plus', fx: 'ask' })
    expect(POSES.done).toMatchObject({ l: 'up', r: 'up' })
    expect(POSES.oops).toMatchObject({ l: 'x', r: 'x' })
    expect(POSES.sleepy).toMatchObject({ l: 'l', r: 'r', fx: 'z' })
  })

  it('wears the colourway it is given', () => {
    const svg = svgOf(render(<Mawl size={32} way="teal" />).container)
    expect(svg.getAttribute('data-way')).toBe('teal')
    expect(svg.querySelector('[data-part="body"]')?.getAttribute('fill')).toBe(WAYS.teal.body)
    expect(svg.querySelector('[data-part="eye"] rect')?.getAttribute('fill')).toBe(WAYS.teal.ink)
  })

  it('keeps the orb the same size on screen across the 48 px switch to flat', () => {
    const diameter = (size: number) => {
      const svg = svgOf(render(<Mawl size={size} />).container)
      const [, , w] = (svg.getAttribute('viewBox') ?? '').split(' ').map(Number)
      const r = Number(svg.querySelector('[data-part="body"]')?.getAttribute('r'))
      return (Number(svg.getAttribute('width')) * 2 * r) / (w ?? 1)
    }
    expect(diameter(47) / diameter(48)).toBeCloseTo(47 / 48, 5)
  })

  it('keeps gradient ids unique per instance and points the body at its own', () => {
    const { container } = render(
      <>
        <Mawl size={160} />
        <Mawl size={160} />
      </>,
    )
    const ids = [...container.querySelectorAll('[id]')].map((n) => n.id)
    expect(ids.length).toBeGreaterThan(0)
    expect(new Set(ids).size).toBe(ids.length)
    const [first] = container.querySelectorAll('svg.mawl')
    const body = first?.querySelector('[data-part="body"]')
    const ref = body?.getAttribute('fill')?.match(/^url\(#(.+)\)$/)?.[1]
    expect(ref && first?.querySelector(`radialGradient[id="${ref}"]`)).toBeTruthy()
  })

  it('is soft from 48 px and flat, with heavier strokes, below it', () => {
    const soft = svgOf(render(<Mawl size={48} state="oops" />).container)
    expect(soft.querySelector('[data-part="body"]')?.getAttribute('fill')).toMatch(/^url\(#/)
    expect(soft.classList).not.toContain('is-flat')
    const flat = svgOf(render(<Mawl size={32} state="oops" />).container)
    expect(flat.querySelector('[data-part="body"]')?.getAttribute('fill')).toMatch(/^#/)
    expect(flat.querySelector('radialGradient')).toBeNull()
    expect(flat.classList).toContain('is-flat')
    const width = (svg: SVGSVGElement) =>
      Number(svg.querySelector('[data-part="eye"] path')?.getAttribute('stroke-width'))
    expect(width(flat)).toBeGreaterThan(width(soft))
  })

  it('is square at the requested size and drops the effects when small', () => {
    const big = svgOf(render(<Mawl size={160} state="sleepy" />).container)
    expect(big.getAttribute('width')).toBe('160')
    expect(big.getAttribute('height')).toBe('160')
    expect(effects(big)).toEqual(['fx-z'])
    const small = svgOf(render(<Mawl size={34} state="sleepy" />).container)
    expect(small.getAttribute('width')).toBe('34')
    expect(small.getAttribute('height')).toBe('34')
    expect(effects(small)).toEqual([])
    expect(glyphs(small)).toEqual(['l', 'r'])
  })

  describe('idle life', () => {
    afterEach(() => {
      vi.useRealTimers()
      setHidden(false)
    })

    it('looks around on its own while idle and large, then comes back', () => {
      vi.useFakeTimers()
      // Look wait 2 s, blink wait 6 s, then up-right, held 0.6 s.
      const { clock } = testClock([0, 0.999, 0.99, 0])
      const svg = svgOf(render(<Mawl size={160} clock={clock} />).container)
      expect(svg.getAttribute('data-gaze')).toBe('centre')
      advance(2000)
      expect(svg.getAttribute('data-gaze')).toBe('upRight')
      advance(600)
      expect(svg.getAttribute('data-gaze')).toBe('centre')
    })

    it('blinks on its own, closing for 120 ms', () => {
      vi.useFakeTimers()
      // Look wait 5 s; blink wait 3 s, single.
      const { clock } = testClock([0.999, 0, 0.9])
      const svg = svgOf(render(<Mawl size={160} clock={clock} />).container)
      advance(3000)
      expect(svg.hasAttribute('data-blink')).toBe(true)
      advance(120)
      expect(svg.hasAttribute('data-blink')).toBe(false)
    })

    it('stays still when small, busy or asked to reduce motion', () => {
      vi.useFakeTimers()
      const cases = [
        (clock: LifeClock) => <Mawl size={40} clock={clock} />,
        (clock: LifeClock) => <Mawl size={160} state="working" clock={clock} />,
        (clock: LifeClock) => reduced(<Mawl size={160} clock={clock} />),
      ]
      for (const ui of cases) {
        const { clock, pending } = testClock([0, 0.99, 0.99, 0])
        const { container, unmount } = render(ui(clock))
        advance(20_000)
        const svg = svgOf(container)
        expect(svg.getAttribute('data-gaze')).toBe('centre')
        expect(svg.hasAttribute('data-blink')).toBe(false)
        expect(pending.size).toBe(0)
        unmount()
      }
    })

    it('stops its timers on unmount and when it leaves idle', () => {
      vi.useFakeTimers()
      const first = testClock([0.5])
      const a = render(<Mawl size={160} clock={first.clock} />)
      expect(first.pending.size).toBeGreaterThan(0)
      a.unmount()
      expect(first.pending.size).toBe(0)
      const second = testClock([0.5])
      const b = render(<Mawl size={160} clock={second.clock} />)
      b.rerender(<Mawl size={160} state="thinking" clock={second.clock} />)
      expect(second.pending.size).toBe(0)
    })

    it('pauses while the tab is hidden and resumes when it shows again', () => {
      vi.useFakeTimers()
      const { clock, pending } = testClock([0, 0.999, 0.99, 0])
      const svg = svgOf(render(<Mawl size={160} clock={clock} />).container)
      setHidden(true)
      expect(pending.size).toBe(0)
      advance(10_000)
      expect(svg.getAttribute('data-gaze')).toBe('centre')
      setHidden(false)
      expect(pending.size).toBeGreaterThan(0)
    })

    it('keeps the eyes inside a clip of the orb circle, so a far look cuts the leading eye', () => {
      const svg = svgOf(render(<Mawl size={160} />).container)
      const clipped = svg.querySelector('[data-part="face"]')
      const ref = clipped?.getAttribute('clip-path')?.match(/^url\(#(.+)\)$/)?.[1]
      const circle = ref ? svg.querySelector(`clipPath[id="${ref}"] circle`) : null
      const body = svg.querySelector('[data-part="body"]')
      for (const attr of ['cx', 'cy', 'r']) {
        expect(circle?.getAttribute(attr), attr).toBe(body?.getAttribute(attr))
      }
      expect(clipped?.querySelectorAll('[data-part="eye"]')).toHaveLength(2)
    })
  })

  it('blinks only with bar eyes', () => {
    const idle = svgOf(render(<Mawl size={160} />).container)
    expect(idle.querySelectorAll('.mawl-blink')).toHaveLength(2)
    const done = svgOf(render(<Mawl size={160} state="done" />).container)
    expect(done.querySelector('.mawl-blink')).toBeNull()
  })

  it('answers hover and press when it can be clicked', () => {
    expect(svgOf(render(<Mawl size={160} />).container).classList).toContain('is-pressable')
    expect(svgOf(render(<Mawl size={40} />).container).classList).not.toContain('is-pressable')
    expect(svgOf(render(reduced(<Mawl size={160} />)).container).classList).not.toContain(
      'is-pressable',
    )
  })

  it('hops when clicked, then lands', () => {
    vi.useFakeTimers()
    try {
      const { container } = render(<Mawl size={160} />)
      const svg = svgOf(container)
      fireEvent.click(svg)
      expect(svg.classList.contains('is-hopping')).toBe(true)
      act(() => void vi.advanceTimersByTime(HOP_MS - 1))
      expect(svg.classList.contains('is-hopping')).toBe(true)
      act(() => void vi.advanceTimersByTime(1))
      expect(svg.classList.contains('is-hopping')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not hop when small', () => {
    const { container } = render(<Mawl size={40} />)
    const svg = svgOf(container)
    fireEvent.click(svg)
    expect(svg.classList.contains('is-hopping')).toBe(false)
  })

  it('does not hop under reduced motion, and holds its pose', () => {
    const { container } = render(reduced(<Mawl size={160} state="sleepy" />))
    const svg = svgOf(container)
    fireEvent.click(svg)
    expect(svg.classList.contains('is-hopping')).toBe(false)
    expect(svg.classList.contains('is-still')).toBe(true)
    expect(effects(svg)).toEqual(['fx-z'])
  })
})
