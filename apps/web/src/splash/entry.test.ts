import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import viteConfig from '../../vitest.config.ts'

const read = (name: string) => readFileSync(resolve(import.meta.dirname, '../..', name), 'utf8')

/**
 * The splash must load from the origin that serves it: Vite in development, Tauri's asset
 * protocol (`http://tauri.localhost`) in the app. Module scripts are always fetched in CORS mode,
 * so a page opened as `file://` or a `data:` snapshot has the opaque `null` origin and its module
 * script is "blocked by CORS policy". Same-origin paths keep every load CORS-free, with no CORS
 * headers on the server at all.
 */
describe('the splash entry', () => {
  it('loads its module script from the same origin, never another host', () => {
    const html = read('splash.html')
    const scripts = [...html.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1] ?? '')
    expect(scripts).toHaveLength(1)
    expect(scripts[0]).toContain('type="module"')
    expect(scripts[0]).toContain('src="/src/splash/main.tsx"')
    expect(html).not.toMatch(/(?:src|href)="(?:https?:)?\/\//)
  })

  it('has no inline script, which the CSP would block', () => {
    for (const name of ['splash.html', 'index.html']) {
      const html = read(name)
      for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
        expect(match[1], name).toContain('src=')
        expect(match[2]?.trim(), name).toBe('')
      }
    }
  })

  it('is built next to the app, so the Tauri host can serve it from its own origin', () => {
    const input = viteConfig.build?.rolldownOptions?.input as Record<string, string>
    expect(Object.keys(input).sort()).toEqual(['index', 'splash'])
    expect(input.splash?.replaceAll('\\', '/')).toMatch(/apps\/web\/splash\.html$/)
  })
})
