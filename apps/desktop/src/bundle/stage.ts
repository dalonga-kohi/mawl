// Stages everything `tauri build --config src-tauri/tauri.bundle.conf.json` puts into the
// installer (PLAN D1.7a, docs/RUNNING.md "Building the desktop installer locally"):
//
//   src-tauri/bundle-stage/server/   server.mjs, drizzle/, web/   -> <resource_dir>\server\
//   src-tauri/bundle-stage/pg/       fetch-pg.ps1 output + pgvector + VC++ runtime -> <resource_dir>\pg\
//   src-tauri/bundle-stage/binaries/mawl-server-<triple>.exe   node.exe, renamed -> mawl-server.exe
//   src-tauri/bundle-stage/stage.json   what was staged (not shipped)
//
//   node src/bundle/stage.ts --pgvector <dir> [--pg <dir>] [--node <node.exe>] [--triple <t>]
//                            [--vc-runtime <dir>] [--allow-system-vc] [--skip-build]
//   node src/bundle/stage.ts --check [--triple <t>]     (tauri.bundle.conf.json's beforeBuildCommand)
//
// Every input is checked before the slow builds start, and the stage (sidecar included) is
// assembled beside the old one and swapped in, so a failed run leaves the previous stage as it
// was. The stage is gitignored: binaries are never committed.
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, cp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  BINARIES_DIR,
  checkNodeVersion,
  missingFromStage,
  PG_MARKER_FILE,
  PG_MARKER_TEXT,
  PGVECTOR_FILES,
  parseRustcHost,
  peFileVersion,
  STAGE_DIR,
  sidecarFileName,
  VC_RUNTIME_DLLS,
  WEB_ENTRY_FILES,
} from './layout.ts'

/** Runs a command and resolves with its stdout; rejects on a non-zero exit. */
export type Run = (cmd: string, args: string[]) => Promise<string>

export interface StageInputs {
  /** apps/desktop/src-tauri */
  srcTauri: string
  /** apps/server/dist after `pnpm --filter @mawl/server build`. */
  serverDist: string
  /** apps/web/dist after `pnpm --filter @mawl/web build` (also Tauri's frontendDist). */
  webDist: string
  /** A Postgres bundle made by infra/desktop/fetch-pg.ps1. */
  pgRoot: string
  /** The pgvector MSVC artifact (flat) or a Postgres root with the extension installed. */
  pgvectorDir: string
  /** Where to look for the VC++ runtime DLLs, in order (`--vc-runtime`, the VS redist dir). */
  vcRuntimeDirs: string[]
  /** System32: used for the VC++ runtime only with `allowSystemVc` on an x64 machine. */
  systemDir?: string
  allowSystemVc?: boolean
  /** `process.arch` by default. */
  arch?: string
  /** The node.exe that becomes the sidecar. */
  node: string
  /** The contents of .nvmrc. */
  nvmrc: string
  triple: string
  skipBuild?: boolean
}

/** File operations a test can replace to simulate a failing swap. */
export interface StageDeps {
  rename?: typeof rename
  rm?: typeof rm
  warn?: (message: string) => void
}

export interface StageResult {
  stage: string
  sidecar: string
  nodeVersion: string
  /** The VC++ runtime DLLs added to pg\bin (the ones the Postgres zip lacks). */
  addedVcRuntime: string[]
  vcRuntimeDir: string | undefined
}

/** stage.json: what a stage was made from. Never shipped (only server\ and pg\ are resources). */
interface StageRecord {
  triple: string
  node: string
  postgres: string
  /** sha256 of the web build's entry pages, so `--check` notices a rebuilt web app. */
  web: Record<string, string>
  vcRuntime: {
    from: string | null
    system: boolean
    added: { name: string; path: string; version: string | null }[]
  }
}

const STAGE_RECORD = 'stage.json'

export type PgvectorFiles = Record<keyof typeof PGVECTOR_FILES, string>

const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex')

/**
 * The three pgvector files, from the flat MSVC artifact or a Postgres root (`lib\`,
 * `share\extension\`). `SHA256SUMS.txt` in `dir` (the CI artifact has one) must list each of the
 * three with a matching hash; anything missing or different throws.
 */
export async function resolvePgvectorFiles(dir: string): Promise<PgvectorFiles> {
  const flat = existsSync(join(dir, PGVECTOR_FILES.dll))
  const files: PgvectorFiles = {
    dll: flat ? join(dir, PGVECTOR_FILES.dll) : join(dir, 'lib', PGVECTOR_FILES.dll),
    control: flat
      ? join(dir, PGVECTOR_FILES.control)
      : join(dir, 'share', 'extension', PGVECTOR_FILES.control),
    sql: flat ? join(dir, PGVECTOR_FILES.sql) : join(dir, 'share', 'extension', PGVECTOR_FILES.sql),
  }
  for (const path of Object.values(files)) {
    if (!existsSync(path)) throw new Error(`pgvector: ${path} is missing`)
  }
  const sumsFile = join(dir, 'SHA256SUMS.txt')
  if (!existsSync(sumsFile)) {
    throw new Error(
      `pgvector: ${sumsFile} is missing; the files are only staged with their checksums`,
    )
  }
  const sums = new Map<string, string>()
  for (const line of (await readFile(sumsFile, 'utf8')).split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(line.trim())
    if (match?.[1] && match[2]) sums.set(match[2], match[1].toLowerCase())
  }
  for (const path of Object.values(files)) {
    const name = basename(path)
    const want = sums.get(name)
    if (!want) throw new Error(`pgvector: no SHA256SUMS.txt entry for ${name}`)
    if (sha256(await readFile(path)) !== want) {
      throw new Error(`pgvector: ${name} does not match SHA256SUMS.txt`)
    }
  }
  return files
}

/** The DLL names in `dir`, lower-cased, mapped to their real paths; empty when it is missing. */
async function dllsIn(dir: string): Promise<Map<string, string>> {
  const names = await readdir(dir).catch(() => [] as string[])
  return new Map(names.map((name) => [name.toLowerCase(), join(dir, name)]))
}

/**
 * The first dir (or its `Microsoft.VC*.CRT` subdir, as in a Visual Studio redist dir) holding all
 * three VC++ runtime DLLs.
 */
export async function findVcRuntime(
  dirs: string[],
): Promise<{ dir: string; files: Record<string, string> } | undefined> {
  for (const base of dirs) {
    const subdirs = (await readdir(base).catch(() => [] as string[]))
      .filter((name) => /^Microsoft\.VC\d+\.CRT$/i.test(name))
      .sort()
      .reverse()
      .map((name) => join(base, name))
    for (const dir of [base, ...subdirs]) {
      const dlls = await dllsIn(dir)
      const files: Record<string, string> = {}
      for (const dll of VC_RUNTIME_DLLS) {
        const path = dlls.get(dll)
        if (path) files[dll] = path
      }
      if (Object.keys(files).length === VC_RUNTIME_DLLS.length) return { dir, files }
    }
  }
  return undefined
}

/** The VC++ runtime to add; System32 only when allowed and on x64. */
async function chooseVcRuntime(
  inputs: StageInputs,
): Promise<{ dir: string; files: Record<string, string>; system: boolean }> {
  const found = await findVcRuntime(inputs.vcRuntimeDirs)
  if (found) return { ...found, system: false }
  const looked = inputs.vcRuntimeDirs.join(', ') || 'no dir given'
  if (!inputs.allowSystemVc || !inputs.systemDir) {
    throw new Error(
      `no complete VC++ runtime (${VC_RUNTIME_DLLS.join(', ')}) in: ${looked}. Pass --vc-runtime <Visual Studio redist dir> (or run in a VS developer shell, which sets VCToolsRedistDir), or --allow-system-vc to copy the DLLs from System32 for a local build`,
    )
  }
  const arch = inputs.arch ?? process.arch
  if (arch !== 'x64') {
    throw new Error(
      `--allow-system-vc copies System32's DLLs, which are x64 only on an x64 machine; this one is ${arch}`,
    )
  }
  const system = await findVcRuntime([inputs.systemDir])
  if (!system) {
    throw new Error(`no complete VC++ runtime in ${looked} or ${inputs.systemDir}`)
  }
  return { ...system, system: true }
}

async function webHashes(webDist: string): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {}
  for (const file of WEB_ENTRY_FILES) hashes[file] = sha256(await readFile(join(webDist, file)))
  return hashes
}

export async function assembleStage(
  inputs: StageInputs,
  run: Run,
  deps: StageDeps = {},
): Promise<StageResult> {
  const fsRename = deps.rename ?? rename
  const fsRm = deps.rm ?? rm
  const warn = deps.warn ?? ((message: string) => process.stderr.write(`warning: ${message}\n`))

  // 1. Inputs, before anything slow or destructive.
  const nodeVersion = checkNodeVersion(await run(inputs.node, ['-v']), inputs.nvmrc)
  const sidecarName = sidecarFileName(inputs.triple)
  const marker = join(inputs.pgRoot, PG_MARKER_FILE)
  if (!existsSync(marker)) {
    throw new Error(
      `${inputs.pgRoot} is not a Postgres bundle from infra/desktop/fetch-pg.ps1 (no ${PG_MARKER_FILE})`,
    )
  }
  const markerText = (await readFile(marker, 'utf8')).trim()
  if (markerText !== PG_MARKER_TEXT) {
    throw new Error(
      `the fetch-pg marker ${marker} says ${JSON.stringify(markerText)}, expected ${JSON.stringify(PG_MARKER_TEXT)}; rerun infra/desktop/fetch-pg.ps1 -Force`,
    )
  }
  const pgvector = await resolvePgvectorFiles(inputs.pgvectorDir)
  const zipDlls = await dllsIn(join(inputs.pgRoot, 'bin'))
  const missingVc = VC_RUNTIME_DLLS.filter((dll) => !zipDlls.has(dll))
  const vcRuntime = missingVc.length > 0 ? await chooseVcRuntime(inputs) : undefined

  // 2. Builds.
  if (!inputs.skipBuild) {
    await run('pnpm', ['--filter', '@mawl/server', 'build'])
    await run('pnpm', ['--filter', '@mawl/web', 'build'])
  }

  // 3. Assemble beside the current stage; a failure removes the half-made one.
  const stage = join(inputs.srcTauri, STAGE_DIR)
  const next = `${stage}.next`
  const sidecar = join(inputs.srcTauri, BINARIES_DIR, sidecarName)
  await fsRm(next, { recursive: true, force: true })
  try {
    const server = join(next, 'server')
    await mkdir(server, { recursive: true })
    await copyFile(join(inputs.serverDist, 'server.mjs'), join(server, 'server.mjs'))
    await cp(join(inputs.serverDist, 'drizzle'), join(server, 'drizzle'), { recursive: true })
    await cp(inputs.webDist, join(server, 'web'), { recursive: true })
    const pg = join(next, 'pg')
    // fetch-pg's marker (and any other dot file at the top) is cache bookkeeping, not install.
    await cp(inputs.pgRoot, pg, {
      recursive: true,
      filter: (source) => source === inputs.pgRoot || !basename(source).startsWith('.'),
    })
    await mkdir(join(pg, 'lib'), { recursive: true })
    await mkdir(join(pg, 'share', 'extension'), { recursive: true })
    await copyFile(pgvector.dll, join(pg, 'lib', PGVECTOR_FILES.dll))
    await copyFile(pgvector.control, join(pg, 'share', 'extension', PGVECTOR_FILES.control))
    await copyFile(pgvector.sql, join(pg, 'share', 'extension', PGVECTOR_FILES.sql))
    const added: StageRecord['vcRuntime']['added'] = []
    for (const dll of missingVc) {
      const from = vcRuntime?.files[dll]
      if (!from) continue
      await copyFile(from, join(pg, 'bin', dll))
      added.push({ name: dll, path: from, version: peFileVersion(await readFile(from)) ?? null })
    }
    const binaries = join(next, 'binaries')
    await mkdir(binaries, { recursive: true })
    await copyFile(inputs.node, join(binaries, sidecarName))

    const missing = missingFromStage(next, existsSync)
    if (missing.length > 0) throw new Error(`the stage is incomplete: ${missing.join(', ')}`)
    const record: StageRecord = {
      triple: inputs.triple,
      node: nodeVersion,
      postgres: markerText,
      web: await webHashes(inputs.webDist),
      vcRuntime: { from: vcRuntime?.dir ?? null, system: vcRuntime?.system ?? false, added },
    }
    await writeFile(join(next, STAGE_RECORD), `${JSON.stringify(record, null, 2)}\n`)

    // 4. Swap it in; the old stage is restored if the new one cannot move into place.
    const old = `${stage}.old`
    await fsRm(old, { recursive: true, force: true })
    const hadOld = existsSync(stage)
    if (hadOld) await fsRename(stage, old)
    try {
      await fsRename(next, stage)
    } catch (error) {
      if (hadOld) await fsRename(old, stage)
      throw error
    }
    try {
      await fsRm(old, { recursive: true, force: true })
    } catch (error) {
      warn(`could not delete ${old} (${error instanceof Error ? error.message : String(error)})`)
    }
  } catch (error) {
    await fsRm(next, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }

  return {
    stage,
    sidecar,
    nodeVersion,
    addedVcRuntime: [...missingVc],
    vcRuntimeDir: vcRuntime?.dir,
  }
}

/**
 * What `tauri build` would miss or get wrong: stage files, the sidecar for `triple`, the splash,
 * and a web build that changed since the stage was made (Tauri embeds the current one).
 */
export async function checkStage(
  srcTauri: string,
  webDist: string,
  triple: string,
): Promise<string[]> {
  const stage = join(srcTauri, STAGE_DIR)
  const problems = missingFromStage(stage, existsSync).map((file) => `${STAGE_DIR}/${file}`)
  const sidecar = `${BINARIES_DIR}/${sidecarFileName(triple)}`
  if (!existsSync(join(srcTauri, sidecar))) problems.push(sidecar)
  const splash = join(webDist, 'splash.html')
  if (!existsSync(splash)) problems.push(splash)
  const recordFile = join(stage, STAGE_RECORD)
  if (!existsSync(recordFile)) {
    problems.push(`${STAGE_DIR}/${STAGE_RECORD}`)
    return problems
  }
  const record = JSON.parse(await readFile(recordFile, 'utf8')) as Partial<StageRecord>
  for (const file of WEB_ENTRY_FILES) {
    const path = join(webDist, file)
    if (!existsSync(path)) continue
    if (record.web?.[file] !== sha256(await readFile(path))) {
      problems.push(`${path} changed since the stage was made`)
    }
  }
  return problems
}

// --- CLI ---

/** Spawns without a shell; pnpm runs through the pnpm that started this script when known. */
const realRun: Run = (cmd, args) =>
  new Promise((done, fail) => {
    let command = cmd
    let argv = args
    let shell = false
    if (cmd === 'pnpm') {
      const pnpm = process.env.npm_execpath
      if (pnpm && /\.c?js$/.test(pnpm)) {
        command = process.execPath
        argv = [pnpm, ...args]
      } else {
        // pnpm.cmd needs a shell on Windows; the arguments are fixed strings from this file.
        shell = true
      }
    }
    const child = spawn(command, argv, { shell, stdio: ['ignore', 'pipe', 'inherit'] })
    let out = ''
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString()
      process.stdout.write(chunk)
    })
    child.on('error', fail)
    child.on('exit', (code) =>
      code === 0 ? done(out) : fail(new Error(`${cmd} ${args.join(' ')} exited with ${code}`)),
    )
  })

function rustcHost(): Promise<string | undefined> {
  return new Promise((done) => {
    execFile('rustc', ['-vV'], (error, stdout) => done(error ? undefined : parseRustcHost(stdout)))
  })
}

async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      check: { type: 'boolean', default: false },
      triple: { type: 'string' },
      node: { type: 'string' },
      pg: { type: 'string' },
      pgvector: { type: 'string' },
      'vc-runtime': { type: 'string' },
      'allow-system-vc': { type: 'boolean', default: false },
      'skip-build': { type: 'boolean', default: false },
    },
  })
  const desktop = resolve(import.meta.dirname, '../..')
  const repo = resolve(desktop, '../..')
  const srcTauri = join(desktop, 'src-tauri')
  const webDist = join(repo, 'apps', 'web', 'dist')
  const triple =
    values.triple ??
    process.env.TAURI_ENV_TARGET_TRIPLE ??
    (await rustcHost()) ??
    'x86_64-pc-windows-gnu'

  if (values.check) {
    const problems = await checkStage(srcTauri, webDist, triple)
    if (problems.length === 0) {
      process.stdout.write(`bundle stage complete for ${triple}\n`)
      return 0
    }
    process.stderr.write(
      `the bundle stage is incomplete or stale for ${triple}; run \`pnpm --filter @mawl/desktop stage\`:\n${problems.map((p) => `  ${p}\n`).join('')}`,
    )
    return 1
  }

  const pgvectorDir = values.pgvector ?? process.env.MAWL_PGVECTOR_DIR
  if (!pgvectorDir) {
    process.stderr.write(
      'pass --pgvector <dir> (or MAWL_PGVECTOR_DIR): the pgvector-windows workflow artifact, or a Postgres root with vector.dll in lib\\, with a SHA256SUMS.txt\n',
    )
    return 2
  }

  let pgRoot = values.pg
  if (!pgRoot) {
    const cache = join(srcTauri, 'target', 'bundle-cache')
    pgRoot = join(cache, 'pg')
    await realRun('pwsh', [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      join(repo, 'infra', 'desktop', 'fetch-pg.ps1'),
      '-Dest',
      pgRoot,
      '-Zip',
      join(cache, 'pg.zip'),
    ])
  }

  const result = await assembleStage(
    {
      srcTauri,
      serverDist: join(repo, 'apps', 'server', 'dist'),
      webDist,
      pgRoot: resolve(pgRoot),
      pgvectorDir: resolve(pgvectorDir),
      vcRuntimeDirs: [
        ...(values['vc-runtime'] ? [resolve(values['vc-runtime'])] : []),
        ...(process.env.VCToolsRedistDir ? [join(process.env.VCToolsRedistDir, 'x64')] : []),
      ],
      systemDir: join(process.env.SystemRoot ?? 'C:\\Windows', 'System32'),
      allowSystemVc: values['allow-system-vc'],
      node: values.node ? resolve(values.node) : process.execPath,
      nvmrc: await readFile(join(repo, '.nvmrc'), 'utf8'),
      triple,
      skipBuild: values['skip-build'],
    },
    realRun,
  )
  process.stdout.write(
    `staged ${result.stage}\nsidecar ${result.sidecar} (Node ${result.nodeVersion})\nVC++ runtime added: ${result.addedVcRuntime.join(', ') || 'none'}${result.vcRuntimeDir ? ` from ${result.vcRuntimeDir}` : ''}\n`,
  )
  return 0
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
