import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MawlAvatar } from './MawlAvatar.tsx'

const svgOf = (container: HTMLElement) => {
  const svg = container.querySelector('svg.mawl-avatar')
  if (!svg) throw new Error('no avatar rendered')
  return svg as SVGSVGElement
}

describe('MawlAvatar', () => {
  it('draws only the body, ears and eyes', () => {
    const svg = svgOf(render(<MawlAvatar size={24} />).container)
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.querySelector('[data-part="body"]')).toBeTruthy()
    expect(svg.querySelector('.mawl-ears')).toBeTruthy()
    expect(svg.querySelector('[data-part^="eyes-"][data-on]')).toBeTruthy()
    expect(svg.querySelector('[data-part^="mouth-"]')).toBeNull()
    expect(svg.querySelector('.mawl-tail')).toBeNull()
    expect(svg.querySelector('[data-part^="fx-"]')).toBeNull()
  })

  it('is square at the requested size', () => {
    const svg = svgOf(render(<MawlAvatar size={16} />).container)
    expect(svg.getAttribute('width')).toBe('16')
    expect(svg.getAttribute('height')).toBe('16')
  })

  it("wears Mawl's own lime unless the teammate has a colour", () => {
    const plain = svgOf(render(<MawlAvatar />).container)
    expect(plain.style.getPropertyValue('--mawl-tint')).toBe('')
    const tinted = svgOf(render(<MawlAvatar color="#3b82f6" />).container)
    expect(tinted.style.getPropertyValue('--mawl-tint')).toBe('#3b82f6')
    expect(tinted.classList.contains('is-tinted')).toBe(true)
  })

  it('shows the state in its eyes only', () => {
    const svg = svgOf(render(<MawlAvatar state="sleepy" />).container)
    expect(svg.getAttribute('data-state')).toBe('sleepy')
    expect(svg.querySelector('[data-on]')?.getAttribute('data-part')).toBe('eyes-closed')
  })

  it('keeps its gradient id unique per instance', () => {
    const { container } = render(
      <>
        <MawlAvatar />
        <MawlAvatar />
      </>,
    )
    const ids = [...container.querySelectorAll('[id]')].map((n) => n.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
