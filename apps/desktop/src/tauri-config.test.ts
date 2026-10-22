import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface TauriConfig {
  build: { frontendDist: string; devUrl: string }
  app: {
    windows: { label: string; create?: boolean; url?: string; visible?: boolean }[]
    security: { csp: string }
  }
}

const config = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../src-tauri/tauri.conf.json'), 'utf8'),
) as TauriConfig

const directives = new Map(
  config.app.security.csp.split(';').map((d) => {
    const [name = '', ...values] = d.trim().split(/\s+/)
    return [name, values] as const
  }),
)

describe('the Tauri window and its CSP', () => {
  it('starts the main window on the bundled splash, served from the app origin', () => {
    const main = config.app.windows.find((w) => w.label === 'main')
    // Built by the host after it has the token and port (initialization script, navigation rule).
    expect(main?.create).toBe(false)
    expect(main?.url).toBe('splash.html')
    // Shown after the splash's first paint, so there is no blank frame.
    expect(main?.visible).toBe(false)
    // The splash comes from the web build over Tauri's asset protocol, never file://, so its
    // module script is same-origin and no CORS applies.
    expect(config.build.frontendDist).toBe('../../web/dist')
    expect(config.build.devUrl).toMatch(/^http:\/\/localhost:\d+$/)
  })

  it('lets the splash run only its own scripts and talk only to the host', () => {
    expect(directives.get('script-src')).toEqual(["'self'"])
    expect(directives.get('object-src')).toEqual(["'none'"])
    expect(directives.get('base-uri')).toEqual(["'self'"])
    expect(directives.get('connect-src')).toEqual(['ipc:', 'http://ipc.localhost'])
  })

  it('has no scheme-wide sources such as http: or ws:', () => {
    for (const [name, values] of directives) {
      for (const value of values) {
        expect(value, name).not.toMatch(/^(https?|wss?):$/)
        expect(value, name).not.toBe('*')
      }
    }
  })
})
