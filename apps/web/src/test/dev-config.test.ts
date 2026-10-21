import { afterEach, describe, expect, it, vi } from 'vitest'

type Proxy = Record<string, string | { target: string; ws?: boolean }>

async function devProxy(): Promise<Proxy> {
  vi.resetModules()
  const mod = await import('../../vitest.config.ts')
  const config = mod.default as { server?: { proxy?: Proxy } }
  return config.server?.proxy ?? {}
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('web dev server config', () => {
  it('proxies /rpc and /ws to the local server on 7420 by default', async () => {
    vi.stubEnv('MAWL_DEV_SERVER', '')
    expect(await devProxy()).toEqual({
      '/rpc': 'http://127.0.0.1:7420',
      '/ws': { target: 'ws://127.0.0.1:7420', ws: true },
    })
  })

  it('follows MAWL_DEV_SERVER, deriving the ws scheme', async () => {
    vi.stubEnv('MAWL_DEV_SERVER', 'http://127.0.0.1:7421')
    expect(await devProxy()).toEqual({
      '/rpc': 'http://127.0.0.1:7421',
      '/ws': { target: 'ws://127.0.0.1:7421', ws: true },
    })
    vi.stubEnv('MAWL_DEV_SERVER', 'https://mawl.example')
    expect((await devProxy())['/ws']).toEqual({ target: 'wss://mawl.example', ws: true })
  })

  it('keeps Playwright specs out of Vitest', async () => {
    const mod = await import('../../vitest.config.ts')
    const exclude = (mod.default as { test?: { exclude?: string[] } }).test?.exclude ?? []
    expect(exclude).toContain('e2e/**')
    expect(exclude).toContain('**/node_modules/**')
  })
})
