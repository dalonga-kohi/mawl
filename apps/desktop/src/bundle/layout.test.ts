import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BINARIES_DIR,
  checkNodeVersion,
  missingFromStage,
  PG_MARKER_TEXT,
  PG_VERSION,
  PG_ZIP_SHA256,
  parseRustcHost,
  peFileVersion,
  REQUIRED_STAGE_FILES,
  SIDECAR_BASE,
  STAGE_DIR,
  sidecarFileName,
} from './layout.ts'

describe('the Postgres bundle pins', () => {
  it('match the pins in infra/desktop/fetch-pg.ps1, which writes the marker', () => {
    const script = readFileSync(
      resolve(import.meta.dirname, '../../../../infra/desktop/fetch-pg.ps1'),
      'utf8',
    )
    expect(/^\$Version = '([^']+)'$/m.exec(script)?.[1]).toBe(PG_VERSION)
    expect(/^\$Sha256 = '([0-9A-F]{64})'$/m.exec(script)?.[1]).toBe(PG_ZIP_SHA256)
    expect(script).toContain('$MarkerText = "postgresql $Version $Sha256"')
    expect(PG_MARKER_TEXT).toBe(`postgresql ${PG_VERSION} ${PG_ZIP_SHA256}`)
  })
})

describe('PE file versions', () => {
  it('reads the version from the VS_FIXEDFILEINFO block', () => {
    const buf = Buffer.alloc(64)
    buf.writeUInt32LE(0xfeef04bd, 20)
    buf.writeUInt32LE(0x00010000, 24) // struct version
    buf.writeUInt32LE(14 * 65536 + 44, 28) // MS: 14.44
    buf.writeUInt32LE(35211 * 65536, 32) // LS: 35211.0
    expect(peFileVersion(buf)).toBe('14.44.35211.0')
  })

  it('has no version without the block', () => {
    expect(peFileVersion(Buffer.from('MZ not a versioned dll'))).toBeUndefined()
  })
})

describe('the bundle layout', () => {
  it('keeps the sidecar inside the stage, so it is swapped in with the rest', () => {
    expect(BINARIES_DIR).toBe(`${STAGE_DIR}/binaries`)
    expect(SIDECAR_BASE).toBe(`${STAGE_DIR}/binaries/mawl-server`)
  })

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
