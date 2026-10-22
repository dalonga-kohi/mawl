import { cleanup, configure } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// The default 1 s for findBy/waitFor is too tight when a lazy route chunk is transformed for the
// first time on a slow CI runner; a test that passes still returns as soon as it can.
configure({ asyncUtilTimeout: 5000 })

afterEach(() => {
  cleanup()
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('style')
  document.documentElement.classList.remove('reduce-motion')
})

// jsdom has no matchMedia. Tests that care about the system theme stub it with `stubColorScheme`.
if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })
}

// Radix and cmdk measure and observe elements; jsdom implements neither.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn()
