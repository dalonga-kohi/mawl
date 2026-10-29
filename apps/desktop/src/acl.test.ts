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
    // The remote Mawl's commands take an address and a token: only the splash may call them.
    for (const command of ['connect_remote', 'use_local_mawl', 'check_remote', 'host_target']) {
      expect(manifestCommands()).toContain(command)
    }
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
    expect(manifestCommands()).not.toContain('take_pending_navigation')
    // No capability names a navigation permission or lets a page drive webviews (the splash does use events).
    for (const capability of capabilities) {
      for (const permission of capability.permissions) {
        const id = typeof permission === 'string' ? permission : permission.identifier
        expect(id, capability.identifier).not.toMatch(/navigat|^core:webview/)
      }
    }
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
  it('gives the app page window chrome only, per exact origin, at run time', () => {
    // The title bar (decorations are off) must drag, minimize, maximize and close from the app
    // page, a remote origin. The port is only known at run time, so the host adds a capability for
    // that exact origin (never a file, never a wildcard) just before it navigates there.
    const titlebar = read('src/titlebar.rs')
    expect(titlebar).toContain('CapabilityBuilder::new(')
    expect(titlebar).toContain('.local(false)')
    expect(titlebar).toContain('.window(MAIN_WINDOW)')
    expect(titlebar).not.toMatch(/\.remote\(\s*"[^"]*\*/)
    const granted = [...titlebar.matchAll(/\.permission\("([^"]+)"\)/g)].map((m) => m[1])
    expect(granted.sort()).toEqual([
      'core:event:allow-listen',
      'core:event:allow-unlisten',
      'core:window:allow-close',
      'core:window:allow-internal-toggle-maximize',
      'core:window:allow-is-focused',
      'core:window:allow-is-maximized',
      'core:window:allow-minimize',
      'core:window:allow-start-dragging',
      'core:window:allow-toggle-maximize',
    ])
    expect(read('src/shell.rs')).toContain('titlebar::allow_window_chrome(')
  })
  it('gives the bundled splash, a local page, exactly the window-chrome permissions its title bar needs', () => {
    // The splash shows the title bar too (also when the server fails), and it is not a remote
    // origin, so a static local capability covers it: no `remote`, no wildcard.
    const base = capabilities.find((c) => c.identifier === 'default')
    expect(base?.windows).toEqual(['main'])
    const window = (base?.permissions ?? [])
      .map((p) => (typeof p === 'string' ? p : p.identifier))
      .filter((id) => /^core:window:allow-/.test(id))
    expect(window.sort()).toEqual([
      'core:window:allow-close',
      'core:window:allow-internal-toggle-maximize',
      'core:window:allow-minimize',
      'core:window:allow-start-dragging',
      'core:window:allow-toggle-maximize',
    ])
  })
})
