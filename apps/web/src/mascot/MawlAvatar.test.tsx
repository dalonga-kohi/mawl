import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { POSES } from './Mawl.tsx'
import { MawlAvatar } from './MawlAvatar.tsx'

const svgOf = (container: HTMLElement) => {
  const svg = container.querySelector('svg.mawl-avatar')
  if (!svg) throw new Error('no avatar rendered')
  return svg as SVGSVGElement
}

describe('MawlAvatar', () => {
  it('draws the orb body and its eyes, nothing else', () => {
    const svg = svgOf(render(<MawlAvatar size={24} />).container)
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.querySelectorAll('[data-part="body"]')).toHaveLength(1)
    expect(svg.querySelectorAll('[data-part="eye"]')).toHaveLength(2)
    expect(svg.querySelector('[data-part^="fx-"]')).toBeNull()
  })

  it('is flat with heavier eyes below 48 px and soft from 48 px', () => {
    const small = svgOf(render(<MawlAvatar size={16} />).container)
    expect(small.classList).toContain('is-flat')
    expect(small.querySelector('radialGradient')).toBeNull()
    const big = svgOf(render(<MawlAvatar size={48} />).container)
    expect(big.classList).not.toContain('is-flat')
    expect(big.querySelector('radialGradient')).toBeTruthy()
  })

  it('is square at the requested size', () => {
    const svg = svgOf(render(<MawlAvatar size={16} />).container)
    expect(svg.getAttribute('width')).toBe('16')
    expect(svg.getAttribute('height')).toBe('16')
  })

  it("wears lavender unless the teammate's color picks another colourway", () => {
    expect(svgOf(render(<MawlAvatar />).container).getAttribute('data-way')).toBe('lavender')
    expect(svgOf(render(<MawlAvatar color="#A9D3F5" />).container).getAttribute('data-way')).toBe(
      'sky',
    )
    expect(
      svgOf(render(<MawlAvatar color="#A9D3F5" way="teal" />).container).getAttribute('data-way'),
    ).toBe('teal')
  })

  it('shows the state in its eyes only', () => {
    const svg = svgOf(render(<MawlAvatar state="sleepy" />).container)
    expect(svg.getAttribute('data-state')).toBe('sleepy')
    const eyes = [...svg.querySelectorAll('[data-part="eye"]')].map((n) =>
      n.getAttribute('data-glyph'),
    )
    expect(eyes).toEqual([POSES.sleepy.l, POSES.sleepy.r])
  })

  it('keeps its gradient id unique per instance', () => {
    const { container } = render(
      <>
        <MawlAvatar size={64} />
        <MawlAvatar size={64} />
      </>,
    )
    const ids = [...container.querySelectorAll('[id]')].map((n) => n.id)
    expect(ids.length).toBe(2)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
