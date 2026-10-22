import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const tauriDir = resolve(import.meta.dirname, '../src-tauri')
const read = (path: string) => readFileSync(resolve(tauriDir, path), 'utf8')

const quoted = (block: string) => [...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1] ?? '')

/** The `COMMANDS` list in build.rs: the app manifest that puts every app command under the ACL. */
function manifestCommands(): string[] {
  const block = /const COMMANDS: &\[&str\] = &\[([\s\S]*?)\];/.exec(read('build.rs'))?.[1]
  return quoted(block ?? '').sort()
}

/** The commands registered with `generate_handler!` in lib.rs, without module paths. */
function handlerCommands(): string[] {
  const block = /generate_handler!\[([\s\S]*?)\]/.exec(read('src/lib.rs'))?.[1] ?? ''
  return block
    .split(',')
    .map((s) => s.trim().split('::').pop() ?? '')
    .filter(Boolean)
    .sort()
}

interface Capability {
  identifier: string
  windows?: string[]
  remote?: unknown
  permissions: (string | { identifier: string })[]
}

const capabilities = readdirSync(resolve(tauriDir, 'capabilities'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(read(`capabilities/${f}`)) as Capability)

/*
 * Tauri 2.12 (webview/mod.rs `on_message`) checks the ACL on app commands when the app declares
 * an app manifest, and always for a remote origin; a capability reaches a remote origin only with
 * a `remote.urls` entry. The app page is served at http://127.0.0.1:<port>, a remote origin, so
 * with no `remote` anywhere it can call no command at all; the splash (Tauri's own origin) can.
 */
describe('the host commands ACL', () => {
  it('declares every registered command in the app manifest, and nothing else', () => {
    expect(manifestCommands()).toEqual(handlerCommands())
    expect(manifestCommands()).toContain('quit_app')
  })

  it('allows each command once, through the local-only host capability', () => {
    const host = capabilities.find((c) => c.identifier === 'host')
    expect(host?.windows).toEqual(['main'])
    const allowed = (host?.permissions ?? []).map((p) => (typeof p === 'string' ? p : p.identifier))
    expect(allowed.sort()).toEqual(manifestCommands().map((c) => `allow-${c.replaceAll('_', '-')}`))
  })

  it('has no channel that tells the app page to navigate: the host navigates the window itself', () => {
    const lib = read('src/lib.rs')
    expect(lib).not.toContain('take_pending_navigation')
    expect(lib).not.toContain('mawl://navigate')
    expect(lib).not.toContain('emit_to')
    expect(manifestCommands()).not.toContain('take_pending_navigation')
  })

  it('grants nothing to a remote origin', () => {
    for (const capability of capabilities) {
      expect(capability.remote, capability.identifier).toBeUndefined()
    }
  })

  it('has no `remote` key in any capability file and no wildcard-port origin', () => {
    const files = readdirSync(resolve(tauriDir, 'capabilities')).filter((f) => f.endsWith('.json'))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const text = read(`capabilities/${file}`)
      // The key, wherever it is nested.
      expect(text, file).not.toMatch(/"remote"\s*:/)
      // An origin whose port is a wildcard would cover whatever local process holds the port.
      expect(text, file).not.toMatch(/(127\.0\.0\.1|localhost|\[::1\]):\*/)
      expect(text, file).not.toMatch(/https?:\/\/(127\.0\.0\.1|localhost|\[::1\])[^"]*\*/)
    }
  })
})
