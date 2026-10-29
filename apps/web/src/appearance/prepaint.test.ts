import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PALETTE_IDS } from '@mawl/ui'
import { afterEach, describe, expect, it } from 'vitest'
import { APPEARANCE_STORAGE_KEY, applyAppearance, loadAppearance } from './prefs.ts'

const web = resolve(import.meta.dirname, '../..')
const source = readFileSync(resolve(web, 'public/prepaint.js'), 'utf8')
const indexHtml = readFileSync(resolve(web, 'index.html'), 'utf8')

/** Runs the script the way the page does, against this document and storage. */
function prepaint() {
  new Function(source)()
}

function attrs(root: HTMLElement) {
  return {
    theme: root.getAttribute('data-theme'),
    palette: root.getAttribute('data-palette'),
    still: root.classList.contains('reduce-motion'),
  }
}

const root = document.documentElement

function reset() {
  window.localStorage.clear()
  root.removeAttribute('data-theme')
  root.removeAttribute('data-palette')
  root.classList.remove('reduce-motion')
}

afterEach(reset)

describe('the pre-paint script', () => {
  it('is loaded from the page head before the app, as a file the CSP allows', () => {
    const head = indexHtml.slice(0, indexHtml.indexOf('</head>'))
    expect(head).toContain('<script src="/prepaint.js"></script>')
    // A classic (blocking) script, not a module or async one: it must run before the first paint.
    expect(head).not.toMatch(/prepaint\.js"[^>]*(type="module"|async|defer)/)
    // No inline script anywhere: the server's CSP is script-src 'self'.
    for (const tag of indexHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
      expect(tag[1]).toContain('src=')
      expect(tag[2]?.trim()).toBe('')
    }
    expect(indexHtml.indexOf('/prepaint.js')).toBeLessThan(indexHtml.indexOf('/src/main.tsx'))
  })

  it('knows exactly the palettes the app knows', () => {
    const list = source.match(/\[([^\]]*)\]/)?.[1] ?? ''
    const ids = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect(ids).toEqual([...PALETTE_IDS])
  })

  it.each([
    { theme: 'dark', palette: 'dracula', reduceMotion: true },
    { theme: 'light', palette: 'rose-pine', reduceMotion: false },
    { theme: 'system', palette: 'nord', reduceMotion: false },
    { theme: 'neon', palette: 'solarized', reduceMotion: 'yes' },
    { theme: 'light', accent: '#F7C4A3' },
    {},
  ])('puts the same attributes on <html> as the app does for %j', (stored) => {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(stored))
    prepaint()
    const early = attrs(root)
    reset()
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(stored))
    applyAppearance(root, loadAppearance(window.localStorage))
    expect(early).toEqual(attrs(root))
  })

  it('leaves the stylesheet defaults when nothing usable is saved, and never throws', () => {
    for (const raw of [null, 'not json', '[1,2]', '42', 'null']) {
      reset()
      if (raw !== null) window.localStorage.setItem(APPEARANCE_STORAGE_KEY, raw)
      expect(prepaint).not.toThrow()
      expect(attrs(root)).toEqual({ theme: null, palette: null, still: false })
    }
  })
})
