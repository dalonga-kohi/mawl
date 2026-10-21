import { act, fireEvent, render } from '@testing-library/react'
import { MotionConfig } from 'motion/react'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { HOP_MS, Mawl, POSES } from './Mawl.tsx'
import { MASCOT_STATES } from './states.ts'

const svgOf = (container: HTMLElement) => {
  const svg = container.querySelector('svg.mawl')
  if (!svg) throw new Error('no Mawl rendered')
  return svg as SVGSVGElement
}
const on = (svg: SVGSVGElement) =>
  [...svg.querySelectorAll('[data-part][data-on]')].map((n) => n.getAttribute('data-part')).sort()
const look = (svg: SVGSVGElement) => svg.querySelector<SVGGElement>('.mawl-look')
const reduced = (ui: ReactElement) => <MotionConfig reducedMotion="always">{ui}</MotionConfig>

/** jsdom has no layout: place the mascot so pointer maths has a centre to work from. */
function placeAt(svg: SVGSVGElement, left: number, top: number, size: number) {
  svg.getBoundingClientRect = () =>
    ({ left, top, width: size, height: size, right: left + size, bottom: top + size }) as DOMRect
}
const nextFrame = () => act(() => new Promise<void>((r) => requestAnimationFrame(() => r())))

describe('Mawl', () => {
  it('is decorative and reports its state', () => {
    const { container } = render(<Mawl state="thinking" />)
    const svg = svgOf(container)
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.getAttribute('data-state')).toBe('thinking')
  })

  it('rests idle by default', () => {
    const { container } = render(<Mawl />)
    expect(svgOf(container).getAttribute('data-state')).toBe('idle')
  })

  it('shows exactly the eyes, mouth and effect of each state', () => {
    for (const state of MASCOT_STATES) {
      const { container, unmount } = render(<Mawl state={state} size={160} />)
      const pose = POSES[state]
      const expected = [`eyes-${pose.eyes}`, `mouth-${pose.mouth}`]
      if (pose.fx) expected.push(`fx-${pose.fx}`)
      expect(on(svgOf(container)), state).toEqual(expected.sort())
      unmount()
    }
  })

  it('gives the new states their own cues', () => {
    expect(POSES.waiting.fx).toBe('alert')
    expect(POSES.listening.look?.y).toBeGreaterThan(0)
    const { container } = render(<Mawl state="listening" size={160} />)
    expect(svgOf(container).style.getPropertyValue('--mawl-look')).toBe('translate(0px, 4px)')
  })

  it('keeps gradient and clip ids unique per instance', () => {
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
    expect(ref && first?.querySelector(`[id="${ref}"]`)).toBeTruthy()
  })

  it('sizes by width and drops the effects when small', () => {
    const big = render(<Mawl size={160} />)
    expect(svgOf(big.container).getAttribute('width')).toBe('160')
    expect(big.container.querySelector('[data-part^="fx-"]')).toBeTruthy()
    const small = render(<Mawl size={16} state="done" />)
    const svg = svgOf(small.container)
    expect(svg.getAttribute('width')).toBe('16')
    expect(small.container.querySelector('[data-part^="fx-"]')).toBeNull()
    expect(on(svg)).toContain('eyes-happy')
  })

  it('follows the pointer with its eyes while idle and large', async () => {
    const { container } = render(<Mawl size={160} />)
    const svg = svgOf(container)
    placeAt(svg, 0, 0, 160)
    fireEvent.pointerMove(document, { clientX: 2000, clientY: 80 })
    await nextFrame()
    expect(look(svg)?.style.transform).toMatch(/^translate\(5(\.0)?px/)
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

  it('does not hop under reduced motion', () => {
    const { container } = render(reduced(<Mawl size={160} />))
    const svg = svgOf(container)
    fireEvent.click(svg)
    expect(svg.classList.contains('is-hopping')).toBe(false)
    expect(svg.classList.contains('is-still')).toBe(true)
  })
})
