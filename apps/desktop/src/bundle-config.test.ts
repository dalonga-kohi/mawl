import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BINARIES_DIR,
  RESOURCE_MAP,
  SIDECAR_BASE,
  SIDECAR_EXE,
  STAGE_DIR,
} from './bundle/layout.ts'

const srcTauri = resolve(import.meta.dirname, '../src-tauri')
const read = (path: string) => readFileSync(resolve(srcTauri, path), 'utf8')

interface BundleSection {
  targets?: unknown
  useLocalToolsDir?: boolean
  externalBin?: string[]
  resources?: Record<string, string> | string[]
  windows?: { nsis?: { installMode?: string } }
}
interface Config {
  build?: { frontendDist?: string; beforeBuildCommand?: string }
  bundle?: BundleSection
  plugins?: { 'deep-link'?: { desktop?: { schemes?: string[] } } }
}

const base = JSON.parse(read('tauri.conf.json')) as Config
const release = JSON.parse(read('tauri.bundle.conf.json')) as Config
const launchRs = read('host/src/launch.rs')
const pkg = JSON.parse(readFileSync(resolve(srcTauri, '../package.json'), 'utf8')) as {
  scripts: Record<string, string>
}

describe('the installer config', () => {
  it('builds one per-user NSIS installer with the tools kept in the target dir', () => {
    expect(base.bundle?.targets).toEqual(['nsis'])
    expect(base.bundle?.windows?.nsis?.installMode).toBe('currentUser')
    expect(base.bundle?.useLocalToolsDir).toBe(true)
  })

  it('keeps the sidecar and resources out of the base config', () => {
    // tauri-build copies externalBin and resources on every cargo build, so in the base config
    // `tauri dev` and `cargo test` would fail until the bundle is staged.
    expect(base.bundle?.externalBin).toBeUndefined()
    expect(base.bundle?.resources).toBeUndefined()
  })

  it('release builds merge the bundle config and check the stage first', () => {
    expect(pkg.scripts.build).toBe('tauri build --config src-tauri/tauri.bundle.conf.json')
    expect(release.build?.beforeBuildCommand).toBe('pnpm --filter @mawl/desktop stage:check')
    expect(pkg.scripts['stage:check']).toContain('--check')
  })

  it('ships the sidecar under the name the host launches', () => {
    expect(release.bundle?.externalBin).toEqual([SIDECAR_BASE])
    expect(SIDECAR_BASE).toBe(`${BINARIES_DIR}/mawl-server`)
    // Tauri installs `<base>-<triple>.exe` as `<file name of base>.exe` beside Mawl.exe.
    expect(`${SIDECAR_BASE.split('/').at(-1)}.exe`).toBe(SIDECAR_EXE)
    expect(launchRs).toContain(`pub const SIDECAR_EXE: &str = "${SIDECAR_EXE}";`)
  })

  it('maps the stage onto the resource dir layout the host resolves', () => {
    expect(release.bundle?.resources).toEqual(RESOURCE_MAP)
    expect(RESOURCE_MAP).toEqual({
      [`${STAGE_DIR}/server/`]: 'server/',
      [`${STAGE_DIR}/pg/`]: 'pg/',
    })
    // host/src/launch.rs: resource_dir\server\server.mjs, resource_dir\pg, server\web\index.html.
    // The host strips the \\?\ prefix first (node cannot start a main script under it).
    expect(launchRs).toContain('let resource_dir = strip_verbatim(layout.resource_dir);')
    expect(launchRs).toContain('resource_dir.join("server")')
    expect(launchRs).toContain('server_dir.join("server.mjs")')
    expect(launchRs).toContain('resource_dir.join("pg")')
    expect(launchRs).toContain('server_dir.join("web")')
  })

  it('registers mawl:// through the deep-link plugin config, which the NSIS template reads', () => {
    expect(base.plugins?.['deep-link']?.desktop?.schemes).toEqual(['mawl'])
  })

  it('embeds the web build, which holds the splash entry', () => {
    // Relative to src-tauri: apps/web/dist, the output of `pnpm --filter @mawl/web build`.
    expect(resolve(srcTauri, base.build?.frontendDist ?? '')).toBe(
      resolve(srcTauri, '../../web/dist'),
    )
    const vite = readFileSync(resolve(srcTauri, '../../web/vitest.config.ts'), 'utf8')
    expect(vite).toContain("splash: resolve(import.meta.dirname, 'splash.html')")
  })

  it('never commits the stage or the sidecar binaries', () => {
    const ignore = read('.gitignore').split(/\r?\n/)
    for (const suffix of ['', '.next', '.old']) expect(ignore).toContain(`/${STAGE_DIR}${suffix}/`)
    // The sidecar lives inside the ignored stage.
    expect(BINARIES_DIR.startsWith(`${STAGE_DIR}/`)).toBe(true)
  })
})
