// Stages everything `tauri build --config src-tauri/tauri.bundle.conf.json` puts into the
// installer (PLAN D1.7a, docs/RUNNING.md "Desktop installer"):
//
//   src-tauri/bundle-stage/server/   server.mjs, drizzle/, web/   -> <resource_dir>\server\
//   src-tauri/bundle-stage/pg/       fetch-pg.ps1 output + pgvector + VC++ runtime -> <resource_dir>\pg\
//   src-tauri/binaries/mawl-server-<triple>.exe   node.exe, renamed  -> mawl-server.exe
//
//   node src/bundle/stage.ts --pgvector <dir> [--pg <dir>] [--node <node.exe>] [--triple <t>]
//                            [--vc-runtime <dir>] [--skip-build]
//   node src/bundle/stage.ts --check [--triple <t>]     (tauri.bundle.conf.json's beforeBuildCommand)
//
// Every input is checked before the slow builds start, and the stage is assembled beside the old
// one and swapped in, so a failed run leaves the previous stage as it was. Both output dirs are
// gitignored: binaries are never committed.
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, cp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  BINARIES_DIR,
  checkNodeVersion,
  missingFromStage,
  PGVECTOR_FILES,
  parseRustcHost,
  STAGE_DIR,
  sidecarFileName,
  VC_RUNTIME_DLLS,
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
  /** Where to look for the VC++ runtime DLLs, in order. */
  vcRuntimeDirs: string[]
  /** The node.exe that becomes the sidecar. */
  node: string
  /** The contents of .nvmrc. */
  nvmrc: string
  triple: string
  skipBuild?: boolean
}

export interface StageResult {
  stage: string
  sidecar: string
  nodeVersion: string
  /** The VC++ runtime DLLs added to pg\bin (the ones the Postgres zip lacks). */
  addedVcRuntime: string[]
  vcRuntimeDir: string | undefined
}

export type PgvectorFiles = Record<keyof typeof PGVECTOR_FILES, string>

const PG_MARKER = '.mawl-pg-bundle'

/**
 * The three pgvector files, from the flat MSVC artifact or a Postgres root (`lib\`,
 * `share\extension\`). A `SHA256SUMS.txt` beside them (the CI artifact has one) is enforced.
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
  const sums = join(dir, 'SHA256SUMS.txt')
  if (existsSync(sums)) {
    const byName = new Map(Object.values(files).map((p) => [p.split(/[\\/]/).at(-1), p]))
    for (const line of (await readFile(sums, 'utf8')).split(/\r?\n/)) {
      const match = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(line.trim())
      const path = match?.[2] ? byName.get(match[2]) : undefined
      if (!match?.[1] || !path) continue
      const got = createHash('sha256')
        .update(await readFile(path))
        .digest('hex')
      if (got !== match[1].toLowerCase()) {
        throw new Error(`pgvector: ${match[2]} does not match SHA256SUMS.txt`)
      }
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

export async function assembleStage(inputs: StageInputs, run: Run): Promise<StageResult> {
  // 1. Inputs, before anything slow or destructive.
  const nodeVersion = checkNodeVersion(await run(inputs.node, ['-v']), inputs.nvmrc)
  const sidecarName = sidecarFileName(inputs.triple)
  const marker = join(inputs.pgRoot, PG_MARKER)
  if (!existsSync(marker)) {
    throw new Error(
      `${inputs.pgRoot} is not a Postgres bundle from infra/desktop/fetch-pg.ps1 (no ${PG_MARKER})`,
    )
  }
  const pgvector = await resolvePgvectorFiles(inputs.pgvectorDir)
  const zipDlls = await dllsIn(join(inputs.pgRoot, 'bin'))
  const missingVc = VC_RUNTIME_DLLS.filter((dll) => !zipDlls.has(dll))
  const vcRuntime = missingVc.length > 0 ? await findVcRuntime(inputs.vcRuntimeDirs) : undefined
  if (missingVc.length > 0 && !vcRuntime) {
    throw new Error(
      `no complete VC++ runtime (${VC_RUNTIME_DLLS.join(', ')}) in: ${inputs.vcRuntimeDirs.join(', ')}`,
    )
  }

  // 2. Builds.
  if (!inputs.skipBuild) {
    await run('pnpm', ['--filter', '@mawl/server', 'build'])
    await run('pnpm', ['--filter', '@mawl/web', 'build'])
  }

  // 3. Assemble beside the current stage.
  const stage = join(inputs.srcTauri, STAGE_DIR)
  const next = `${stage}.next`
  await rm(next, { recursive: true, force: true })
  const server = join(next, 'server')
  await mkdir(server, { recursive: true })
  await copyFile(join(inputs.serverDist, 'server.mjs'), join(server, 'server.mjs'))
  await cp(join(inputs.serverDist, 'drizzle'), join(server, 'drizzle'), { recursive: true })
  await cp(inputs.webDist, join(server, 'web'), { recursive: true })
  const pg = join(next, 'pg')
  await cp(inputs.pgRoot, pg, { recursive: true })
  await mkdir(join(pg, 'lib'), { recursive: true })
  await mkdir(join(pg, 'share', 'extension'), { recursive: true })
  await copyFile(pgvector.dll, join(pg, 'lib', PGVECTOR_FILES.dll))
  await copyFile(pgvector.control, join(pg, 'share', 'extension', PGVECTOR_FILES.control))
  await copyFile(pgvector.sql, join(pg, 'share', 'extension', PGVECTOR_FILES.sql))
  for (const dll of missingVc) {
    const from = vcRuntime?.files[dll]
    if (from) await copyFile(from, join(pg, 'bin', dll))
  }
  const missing = missingFromStage(next, existsSync)
  if (missing.length > 0) throw new Error(`the stage is incomplete: ${missing.join(', ')}`)
  await writeFile(
    join(next, 'stage.json'),
    `${JSON.stringify(
      {
        triple: inputs.triple,
        node: nodeVersion,
        postgres: (await readFile(marker, 'utf8')).trim(),
        vcRuntimeFrom: vcRuntime?.dir ?? null,
        addedVcRuntime: missingVc,
      },
      null,
      2,
    )}\n`,
  )

  // 4. Swap it in; the old stage is restored if the new one cannot move into place.
  const old = `${stage}.old`
  await rm(old, { recursive: true, force: true })
  const hadOld = existsSync(stage)
  if (hadOld) await rename(stage, old)
  try {
    await rename(next, stage)
  } catch (error) {
    if (hadOld) await rename(old, stage)
    throw error
  }
  await rm(old, { recursive: true, force: true })

  // 5. The sidecar.
  const binaries = join(inputs.srcTauri, BINARIES_DIR)
  await mkdir(binaries, { recursive: true })
  const sidecar = join(binaries, sidecarName)
  await copyFile(inputs.node, sidecar)

  return {
    stage,
    sidecar,
    nodeVersion,
    addedVcRuntime: [...missingVc],
    vcRuntimeDir: vcRuntime?.dir,
  }
}

/** What `tauri build` would miss: stage files, the sidecar for `triple`, the splash. */
export async function checkStage(
  srcTauri: string,
  webDist: string,
  triple: string,
): Promise<string[]> {
  const problems = missingFromStage(join(srcTauri, STAGE_DIR), existsSync).map(
    (file) => `${STAGE_DIR}/${file}`,
  )
  const sidecar = `${BINARIES_DIR}/${sidecarFileName(triple)}`
  if (!existsSync(join(srcTauri, sidecar))) problems.push(sidecar)
  const splash = join(webDist, 'splash.html')
  if (!existsSync(splash)) problems.push(splash)
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
      `the bundle stage is incomplete for ${triple}; run \`pnpm --filter @mawl/desktop stage\`:\n${problems.map((p) => `  ${p}\n`).join('')}`,
    )
    return 1
  }

  const pgvectorDir = values.pgvector ?? process.env.MAWL_PGVECTOR_DIR
  if (!pgvectorDir) {
    process.stderr.write(
      'pass --pgvector <dir> (or MAWL_PGVECTOR_DIR): the pgvector-windows workflow artifact, or a Postgres root with vector.dll in lib\\\n',
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

  const system32 = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')
  const vcRuntimeDirs = [
    ...(values['vc-runtime'] ? [values['vc-runtime']] : []),
    ...(process.env.VCToolsRedistDir ? [join(process.env.VCToolsRedistDir, 'x64')] : []),
    system32,
  ]

  const result = await assembleStage(
    {
      srcTauri,
      serverDist: join(repo, 'apps', 'server', 'dist'),
      webDist,
      pgRoot: resolve(pgRoot),
      pgvectorDir: resolve(pgvectorDir),
      vcRuntimeDirs,
      node: values.node ? resolve(values.node) : process.execPath,
      nvmrc: await readFile(join(repo, '.nvmrc'), 'utf8'),
      triple,
      skipBuild: values['skip-build'],
    },
    realRun,
  )
  if (result.vcRuntimeDir?.toLowerCase() === system32.toLowerCase()) {
    process.stderr.write(
      'warning: the VC++ runtime came from System32; release builds should pass --vc-runtime <Visual Studio redist dir> (or run in a VS developer shell, which sets VCToolsRedistDir)\n',
    )
  }
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
