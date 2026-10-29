import { describe, expect, it, vi } from 'vitest'

async function fixture() {
  const frames = new Map<number, (time: number) => void>()
  let next = 0
  const draw = vi.fn()
  const { createWaveLoop } = await import(new URL('../site/wave-loop.js', import.meta.url).href)
  const loop = createWaveLoop({
    draw,
    requestFrame: (callback: (time: number) => void) => {
      frames.set(++next, callback)
      return next
    },
    cancelFrame: (id: number) => frames.delete(id),
  })
  const tick = (time: number) => {
    const pending = [...frames.values()]
    frames.clear()
    for (const callback of pending) callback(time)
  }
  return { loop, frames, draw, tick }
}

describe('hero wave lifecycle', () => {
  it('renders a still frame without scheduling motion for reduced-motion visitors', async () => {
    const { loop, frames, draw } = await fixture()
    loop.setState({ reduced: true })
    expect(draw).toHaveBeenCalledOnce()
    expect(frames.size).toBe(0)
  })

  it('suspends hidden tabs and resumes without a time jump or duplicate loops', async () => {
    const { loop, frames, draw, tick } = await fixture()
    loop.setState({})
    loop.setState({})
    expect(frames.size).toBe(1)
    tick(100)
    tick(150)
    const before = draw.mock.lastCall?.[0]
    loop.setState({ hidden: true })
    expect(frames.size).toBe(0)
    loop.setState({ hidden: false })
    tick(90000)
    expect(draw.mock.lastCall?.[0]).toBe(before)
    expect(frames.size).toBe(1)
  })

  it('preserves a manual pause across preference and visibility changes', async () => {
    const { loop, frames } = await fixture()
    loop.setState({ paused: true })
    loop.setState({ reduced: true, hidden: true })
    loop.setState({ reduced: false, hidden: false })
    expect(frames.size).toBe(0)
    loop.setState({ paused: false })
    expect(frames.size).toBe(1)
  })

  it('caps rendering at 30 fps and releases the scheduled frame on disposal', async () => {
    const { loop, draw, frames, tick } = await fixture()
    loop.setState({})
    tick(100)
    draw.mockClear()
    tick(116)
    tick(132)
    expect(draw).not.toHaveBeenCalled()
    tick(150)
    expect(draw).toHaveBeenCalledOnce()
    loop.dispose()
    expect(frames.size).toBe(0)
    loop.setState({ paused: false })
    expect(frames.size).toBe(0)
  })
})
