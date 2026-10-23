import { describe, expect, it } from 'vitest'
import {
  checkNodeVersion,
  missingFromStage,
  parseRustcHost,
  REQUIRED_STAGE_FILES,
  sidecarFileName,
} from './layout.ts'

describe('the bundle layout', () => {
  it('names the sidecar after the Rust target triple, as Tauri looks it up', () => {
    expect(sidecarFileName('x86_64-pc-windows-gnu')).toBe('mawl-server-x86_64-pc-windows-gnu.exe')
    expect(sidecarFileName('x86_64-pc-windows-msvc')).toBe('mawl-server-x86_64-pc-windows-msvc.exe')
    expect(sidecarFileName('aarch64-pc-windows-msvc')).toBe(
      'mawl-server-aarch64-pc-windows-msvc.exe',
    )
  })

  it('refuses a triple that is not a Windows target or could escape the binaries dir', () => {
    for (const bad of ['x86_64-unknown-linux-gnu', '../x86_64-pc-windows-gnu', '', 'gnu']) {
      expect(() => sidecarFileName(bad), bad).toThrow(/target triple/)
    }
  })

  it('reads the host triple from `rustc -vV`', () => {
    const out = 'rustc 1.99.0 (b940084d7 2026-09-28)\nbinary: rustc\nhost: x86_64-pc-windows-gnu\n'
    expect(parseRustcHost(out)).toBe('x86_64-pc-windows-gnu')
    expect(parseRustcHost('host: x86_64-pc-windows-msvc\r\nrelease: 1.99.0\r\n')).toBe(
      'x86_64-pc-windows-msvc',
    )
    expect(parseRustcHost('binary: rustc\n')).toBeUndefined()
  })

  it('accepts only a node whose major version is the one in .nvmrc', () => {
    expect(checkNodeVersion('v24.19.0\n', '24\n')).toBe('24.19.0')
    expect(checkNodeVersion('v24.0.1', 'v24')).toBe('24.0.1')
    expect(() => checkNodeVersion('v25.1.0', '24')).toThrow(/Node 25\.1\.0.*\.nvmrc wants 24/)
    expect(() => checkNodeVersion('v2.4.0', '24')).toThrow(/\.nvmrc wants 24/)
    expect(() => checkNodeVersion('garbage', '24')).toThrow(/version/)
  })

  it('lists the staged files the installed host needs', () => {
    // What host/src/launch.rs resolves, plus what Postgres and pgvector need at runtime.
    expect(REQUIRED_STAGE_FILES).toEqual(
      expect.arrayContaining([
        'server/server.mjs',
        'server/drizzle/meta/_journal.json',
        'server/web/index.html',
        'pg/bin/postgres.exe',
        'pg/bin/initdb.exe',
        'pg/bin/pg_ctl.exe',
        'pg/bin/vcruntime140.dll',
        'pg/bin/vcruntime140_1.dll',
        'pg/bin/msvcp140.dll',
        'pg/lib/vector.dll',
        'pg/share/extension/vector.control',
        'pg/share/extension/vector--0.8.7.sql',
      ]),
    )
  })

  it('reports exactly the required files a stage is missing', () => {
    const present = new Set(REQUIRED_STAGE_FILES.filter((f) => !f.includes('vector')))
    const missing = missingFromStage('C:/stage', (path) =>
      present.has(path.replace('C:/stage/', '')),
    )
    expect(missing).toEqual([
      'pg/lib/vector.dll',
      'pg/share/extension/vector.control',
      'pg/share/extension/vector--0.8.7.sql',
    ])
    expect(missingFromStage('C:/stage', () => true)).toEqual([])
  })
})
