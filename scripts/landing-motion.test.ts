import { afterEach, describe, expect, it, vi } from 'vitest'

function element() {
  return {
    clientHeight: 876,
    scrollHeight: 5000,
    tabIndex: 0,
    textContent: '',
    style: { opacity: '', transform: '', removeProperty: vi.fn() },
    classList: { toggle: vi.fn(), add: vi.fn(), remove: vi.fn() },
    setAttribute: vi.fn(),
    addEventListener: vi.fn(),
    getBoundingClientRect: () => ({ top: 0 }),
  }
}

async function fixture(initiallyPaused = false, fontsLoading = false) {
  const elements = new Map<string, ReturnType<typeof element>>()
  const node = (selector: string) => {
    let result = elements.get(selector)
    if (!result) {
      result = element()
      elements.set(selector, result)
    }
    return result
  }
  const frames: Array<() => void> = []
  const dispatchEvent = vi.fn()
  let finishFonts = () => {}
  const ready = new Promise<void>((resolve) => {
    finishFonts = resolve
  })
  vi.stubGlobal('document', {
    documentElement: node('root'),
    body: node('body'),
    querySelector: node,
    fonts: { status: fontsLoading ? 'loading' : 'loaded', ready },
  })
  vi.stubGlobal('window', { dispatchEvent })
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn() }))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
    },
  )
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => frames.push(callback))
  vi.stubGlobal('addEventListener', vi.fn())
  vi.stubGlobal('innerHeight', 900)
  vi.stubGlobal('scrollY', 0)
  const animate = vi.fn((_target: unknown, _keyframes: unknown, _options: unknown) => ({
    cancel: vi.fn(),
    stop: vi.fn(),
  }))
  const motion = { animate, scroll: vi.fn(() => vi.fn()) }
  let paused = initiallyPaused
  // Dynamic URL import exercises the buildless JS module without adding it to the TS compilation.
  const { createScrollExperience } = (await import(
    new URL('../site/scroll-experience.js', import.meta.url).href
  )) as {
    createScrollExperience(options: {
      motion: typeof motion
      reducedMotion: { matches: boolean }
      isPaused: () => boolean
    }): { sync(): void; refresh(): void }
  }
  const experience = createScrollExperience({
    motion,
    reducedMotion: { matches: false },
    isPaused: () => paused,
  })
  return {
    experience,
    motion,
    node,
    dispatchEvent,
    finishFonts,
    pause() {
      paused = true
      experience.sync()
    },
    flush() {
      for (const frame of frames.splice(0)) frame()
    },
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('landing scroll animation continuity', () => {
  it('waits for the real font layout before measuring scroll timelines', async () => {
    const { experience, motion, finishFonts } = await fixture(false, true)
    experience.sync()
    expect(motion.animate).not.toHaveBeenCalled()
    finishFonts()
    await Promise.resolve()
    expect(motion.animate.mock.calls.length).toBeGreaterThan(0)
  })
  it('does not free-run scroll effects before their timelines attach', async () => {
    const { experience, motion } = await fixture()
    experience.sync()
    expect(motion.animate.mock.calls.length).toBeGreaterThan(0)
    for (const call of motion.animate.mock.calls) expect(call[2]).toMatchObject({ autoplay: false })
  })

  it('keeps the active hero timeline when an example changes the page layout', async () => {
    const { experience, motion, flush, dispatchEvent } = await fixture()
    experience.sync()
    const count = motion.animate.mock.calls.length
    const hero = motion.animate.mock.results[0]?.value
    expect(hero).toBeDefined()
    experience.refresh()
    experience.refresh()
    flush()
    expect(motion.animate).toHaveBeenCalledTimes(count)
    expect(hero?.cancel).not.toHaveBeenCalled()
    expect(hero?.stop).not.toHaveBeenCalled()
    expect(dispatchEvent).toHaveBeenCalledOnce()
    expect(dispatchEvent.mock.calls[0]?.[0]).toMatchObject({ type: 'resize' })
  })

  it('still cancels animations and restores readable content when paused', async () => {
    const { experience, motion, pause, flush, node } = await fixture()
    experience.sync()
    pause()
    flush()
    for (const result of motion.animate.mock.results)
      expect(result.value.cancel).toHaveBeenCalledOnce()
    expect(node('.app-window').style.opacity).toBe('1')
  })
})
