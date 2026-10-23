// The installed layout the Tauri host expects (host/src/launch.rs), and the staging paths that
// produce it. `tauri build --config src-tauri/tauri.bundle.conf.json` maps the stage into the
// installer: `bundle-stage/server/` -> `<resource_dir>\server\`, `bundle-stage/pg/` ->
// `<resource_dir>\pg\`, and `bundle-stage/binaries/mawl-server-<triple>.exe` -> `mawl-server.exe` beside
// `Mawl.exe`. A config test keeps the three in step.
//
// Pure functions only: this file runs under Vitest and, through stage.ts, under plain Node 24
// (type stripping), so it imports nothing but Node built-ins.

/** Relative to `apps/desktop/src-tauri`, like every path in the Tauri config. */
export const STAGE_DIR = 'bundle-stage'
/** Inside the stage, so the sidecar is swapped in with the files it runs (not a resource). */
export const BINARIES_DIR = `${STAGE_DIR}/binaries`
/** The `bundle.externalBin` entry; Tauri appends `-<triple>.exe`. */
export const SIDECAR_BASE = `${BINARIES_DIR}/mawl-server`
/** The name the installer gives the sidecar (`launch::SIDECAR_EXE`). */
export const SIDECAR_EXE = 'mawl-server.exe'
export const PGVECTOR_VERSION = '0.8.7'

/**
 * The pins of infra/desktop/fetch-pg.ps1 (a test keeps them equal) and the marker it writes into
 * a finished bundle. The stager accepts a Postgres dir only with exactly this marker.
 */
export const PG_VERSION = '17.10-1'
export const PG_ZIP_SHA256 = 'F9AAFCA58E7026A1EF2CAEEE711ACF761671E57904D430ADC85F468374F5A821'
export const PG_MARKER_FILE = '.mawl-pg-bundle'
export const PG_MARKER_TEXT = `postgresql ${PG_VERSION} ${PG_ZIP_SHA256}`

/** The web build's entry pages; their hashes tie a stage to the build Tauri embeds. */
export const WEB_ENTRY_FILES = ['index.html', 'splash.html'] as const

/** `bundle.resources`: stage dir -> resource dir. */
export const RESOURCE_MAP: Readonly<Record<string, string>> = {
  [`${STAGE_DIR}/server/`]: 'server/',
  [`${STAGE_DIR}/pg/`]: 'pg/',
}

/** The pgvector files the installer ships, as named in the MSVC build's artifact. */
export const PGVECTOR_FILES = {
  dll: 'vector.dll',
  control: 'vector.control',
  sql: `vector--${PGVECTOR_VERSION}.sql`,
} as const

/**
 * The VC++ runtime Postgres needs (docs/REDESIGN.md §10.2), shipped app-local in `pg\bin`. The
 * EDB 17.10-1 zip does not include them: its binaries import `VCRUNTIME140.dll` and
 * `MSVCP140.dll`; `VCRUNTIME140_1.dll` is what an MSVC-built extension with C++ exception
 * frames (the CI `vector.dll`) may import.
 */
export const VC_RUNTIME_DLLS = ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll'] as const

/** Files a complete stage must hold, relative to the stage dir, with forward slashes. */
export const REQUIRED_STAGE_FILES: readonly string[] = [
  'server/server.mjs',
  'server/drizzle/meta/_journal.json',
  'server/web/index.html',
  'pg/bin/postgres.exe',
  'pg/bin/initdb.exe',
  'pg/bin/pg_ctl.exe',
  ...VC_RUNTIME_DLLS.map((dll) => `pg/bin/${dll}`),
  `pg/lib/${PGVECTOR_FILES.dll}`,
  `pg/share/extension/${PGVECTOR_FILES.control}`,
  `pg/share/extension/${PGVECTOR_FILES.sql}`,
]

const WINDOWS_TRIPLE = /^(x86_64|aarch64|i686)-pc-windows-(gnu|gnullvm|msvc)$/

/** `binaries/mawl-server-<triple>.exe`'s file name; Windows targets only. */
export function sidecarFileName(triple: string): string {
  if (!WINDOWS_TRIPLE.test(triple)) {
    throw new Error(`not a Windows target triple: ${JSON.stringify(triple)}`)
  }
  return `mawl-server-${triple}.exe`
}

/** The `host:` line of `rustc -vV`. */
export function parseRustcHost(output: string): string | undefined {
  return /^host:\s*(\S+)\s*$/m.exec(output)?.[1]
}

/**
 * Checks `node -v` against `.nvmrc` (a major version) and returns the bare version. The sidecar
 * runs the server bundle built for that major (`target: 'node24'` in apps/server/src/build.ts).
 */
export function checkNodeVersion(nodeVersion: string, nvmrc: string): string {
  const version = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(nodeVersion.trim())
  if (!version) throw new Error(`cannot read a Node version from ${JSON.stringify(nodeVersion)}`)
  const wanted = nvmrc.trim().replace(/^v/, '')
  const bare = `${version[1]}.${version[2]}.${version[3]}`
  if (version[1] !== wanted) {
    throw new Error(`the sidecar would be Node ${bare}, but .nvmrc wants ${wanted}`)
  }
  return bare
}

/**
 * The file version of a PE image from its VS_FIXEDFILEINFO block (signature 0xFEEF04BD, then the
 * struct version, then dwFileVersionMS and dwFileVersionLS), for the record in stage.json.
 */
export function peFileVersion(image: Uint8Array): string | undefined {
  const bytes = Buffer.from(image.buffer, image.byteOffset, image.byteLength)
  const at = bytes.indexOf(Buffer.from([0xbd, 0x04, 0xef, 0xfe]))
  if (at < 0 || at + 16 > bytes.length) return undefined
  const ms = bytes.readUInt32LE(at + 8)
  const ls = bytes.readUInt32LE(at + 12)
  return `${ms >>> 16}.${ms & 0xffff}.${ls >>> 16}.${ls & 0xffff}`
}

/** The required files missing from `stageDir` (joined with `/`), in REQUIRED_STAGE_FILES order. */
export function missingFromStage(stageDir: string, exists: (path: string) => boolean): string[] {
  return REQUIRED_STAGE_FILES.filter((file) => !exists(`${stageDir}/${file}`))
}
