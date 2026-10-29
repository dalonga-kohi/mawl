import { act, fireEvent, render } from '@testing-library/react'
import { MotionConfig } from 'motion/react'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
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
const look = (svg: SVGSVGElement) => svg.querySelector<SVGGElement>('.mawl-look')
const reduced = (ui: ReactElement) => <MotionConfig reducedMotion="always">{ui}</MotionConfig>

/** jsdom has no layout: place the mascot so pointer maths has a centre to work from. */
function placeAt(svg: SVGSVGElement, left: number, top: number, size: number) {
  svg.getBoundingClientRect = () =>
    ({ left, top, width: size, height: size, right: left + size, bottom: top + size }) as DOMRect
}
const nextFrame = () => act(() => new Promise<void>((r) => requestAnimationFrame(() => r())))

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

  it('follows the pointer with its eyes while idle and large', async () => {
    const { container } = render(<Mawl size={160} />)
    const svg = svgOf(container)
    placeAt(svg, 0, 0, 160)
    fireEvent.pointerMove(document, { clientX: 2000, clientY: 80 })
    await nextFrame()
    expect(look(svg)?.style.transform).toMatch(/^translate\(14(\.0)?px/)
  })

  it('follows the pointer from 64 px, not below', async () => {
    const at = render(<Mawl size={64} />)
    const below = render(<Mawl size={63} />)
    placeAt(svgOf(at.container), 0, 0, 64)
    placeAt(svgOf(below.container), 0, 0, 63)
    fireEvent.pointerMove(document, { clientX: 2000, clientY: 30 })
    await nextFrame()
    expect(look(svgOf(at.container))?.style.transform).not.toBe('')
    expect(look(svgOf(below.container))?.style.transform).toBe('')
  })

  it('keeps its eyes still when small, busy or asked to reduce motion', async () => {
    const cases = [
      render(<Mawl size={40} />),
      render(<Mawl size={160} state="working" />),
      render(reduced(<Mawl size={160} />)),
    ]
    for (const { container } of cases) placeAt(svgOf(container), 0, 0, 160)
    fireEvent.pointerMove(document, { clientX: 2000, clientY: 80 })
    await nextFrame()
    for (const { container } of cases) expect(look(svgOf(container))?.style.transform).toBe('')
  })

  it('lets go of the pointer pose when it leaves idle', async () => {
    const { container, rerender } = render(<Mawl size={160} />)
    const svg = svgOf(container)
    placeAt(svg, 0, 0, 160)
    fireEvent.pointerMove(document, { clientX: 2000, clientY: 80 })
    await nextFrame()
    rerender(<Mawl size={160} state="thinking" />)
    expect(look(svg)?.style.transform).toBe('')
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
