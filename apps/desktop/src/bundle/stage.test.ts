import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { missingFromStage, REQUIRED_STAGE_FILES } from './layout.ts'
import {
  assembleStage,
  checkStage,
  findVcRuntime,
  type Run,
  resolvePgvectorFiles,
  type StageInputs,
} from './stage.ts'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mawl-stage-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function put(path: string, content = path): Promise<string> {
  const full = join(root, path)
  await mkdir(dirname(full), { recursive: true })
  await writeFile(full, content)
  return full
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

describe('pgvector files', () => {
  it('takes the flat MSVC artifact layout and checks its SHA256SUMS.txt', async () => {
    await put('vec/vector.dll', 'dll')
    await put('vec/vector.control', 'control')
    await put('vec/vector--0.8.7.sql', 'sql')
    await put(
      'vec/SHA256SUMS.txt',
      `${sha256('control')}  vector.control\n${sha256('dll')}  vector.dll\n${sha256('sql')}  vector--0.8.7.sql\n`,
    )
    const files = await resolvePgvectorFiles(join(root, 'vec'))
    expect(files).toEqual({
      dll: join(root, 'vec', 'vector.dll'),
      control: join(root, 'vec', 'vector.control'),
      sql: join(root, 'vec', 'vector--0.8.7.sql'),
    })
  })

  it('refuses files that do not match SHA256SUMS.txt', async () => {
    await put('vec/vector.dll', 'tampered')
    await put('vec/vector.control', 'control')
    await put('vec/vector--0.8.7.sql', 'sql')
    await put('vec/SHA256SUMS.txt', `${sha256('dll')}  vector.dll\n`)
    await expect(resolvePgvectorFiles(join(root, 'vec'))).rejects.toThrow(
      /vector\.dll does not match SHA256SUMS\.txt/,
    )
  })

  it('also takes a Postgres root with the extension installed (the MinGW fallback)', async () => {
    await put('pgroot/lib/vector.dll')
    await put('pgroot/share/extension/vector.control')
    await put('pgroot/share/extension/vector--0.8.7.sql')
    const files = await resolvePgvectorFiles(join(root, 'pgroot'))
    expect(files.dll).toBe(join(root, 'pgroot', 'lib', 'vector.dll'))
    expect(files.sql).toBe(join(root, 'pgroot', 'share', 'extension', 'vector--0.8.7.sql'))
  })

  it('names the missing file', async () => {
    await put('vec/vector.dll')
    await put('vec/vector.control')
    await expect(resolvePgvectorFiles(join(root, 'vec'))).rejects.toThrow(/vector--0\.8\.7\.sql/)
  })
})

describe('the VC++ runtime', () => {
  it('takes the first dir that has all three DLLs, in any letter case', async () => {
    await put('partial/vcruntime140.dll')
    await put('redist/x64/Microsoft.VC143.CRT/VCRUNTIME140.dll')
    await put('redist/x64/Microsoft.VC143.CRT/vcruntime140_1.dll')
    await put('redist/x64/Microsoft.VC143.CRT/MSVCP140.dll')
    const found = await findVcRuntime([
      join(root, 'missing'),
      join(root, 'partial'),
      join(root, 'redist', 'x64'),
    ])
    const crt = join(root, 'redist', 'x64', 'Microsoft.VC143.CRT')
    expect(found).toEqual({
      dir: crt,
      files: {
        'vcruntime140.dll': join(crt, 'VCRUNTIME140.dll'),
        'vcruntime140_1.dll': join(crt, 'vcruntime140_1.dll'),
        'msvcp140.dll': join(crt, 'MSVCP140.dll'),
      },
    })
  })

  it('finds nothing when no dir is complete', async () => {
    await put('partial/vcruntime140.dll')
    expect(await findVcRuntime([join(root, 'partial')])).toBeUndefined()
  })
})

describe('assembling the stage', () => {
  async function fixture(): Promise<StageInputs> {
    await put('server/dist/server.mjs', 'server')
    await put('server/dist/drizzle/meta/_journal.json', '{}')
    await put('server/dist/drizzle/0000_init.sql', 'sql')
    await put('server/dist/web/index.html', 'stale docker web copy')
    await put('web/dist/index.html', 'app')
    await put('web/dist/splash.html', 'splash')
    await put('web/dist/assets/app.js', 'js')
    await put('pg/.mawl-pg-bundle', 'postgresql 17.10-1 F9AA')
    for (const exe of ['postgres.exe', 'initdb.exe', 'pg_ctl.exe']) await put(`pg/bin/${exe}`)
    await put('pg/bin/msvcp140.dll', 'from the zip')
    await put('pg/share/extension/plpgsql.control')
    await put('vec/vector.dll')
    await put('vec/vector.control')
    await put('vec/vector--0.8.7.sql')
    await put('vc/vcruntime140.dll', 'vc')
    await put('vc/vcruntime140_1.dll', 'vc')
    await put('vc/msvcp140.dll', 'vc')
    await put('node.exe', 'node binary')
    return {
      srcTauri: join(root, 'src-tauri'),
      serverDist: join(root, 'server', 'dist'),
      webDist: join(root, 'web', 'dist'),
      pgRoot: join(root, 'pg'),
      pgvectorDir: join(root, 'vec'),
      vcRuntimeDirs: [join(root, 'vc')],
      node: join(root, 'node.exe'),
      nvmrc: '24\n',
      triple: 'x86_64-pc-windows-gnu',
    }
  }

  function fakeRun(nodeVersion = 'v24.19.0'): Run & { calls: string[][] } {
    const calls: string[][] = []
    const run: Run = async (cmd, args) => {
      calls.push([cmd, ...args])
      return args[0] === '-v' ? `${nodeVersion}\n` : ''
    }
    return Object.assign(run, { calls })
  }

  it('builds the server and web app, then lays out the bundle the host expects', async () => {
    const inputs = await fixture()
    const run = fakeRun()
    const result = await assembleStage(inputs, run)

    const stage = join(root, 'src-tauri', 'bundle-stage')
    expect(missingFromStage(stage, existsSync)).toEqual([])
    expect(REQUIRED_STAGE_FILES.length).toBeGreaterThan(10)
    expect(await readFile(join(stage, 'server', 'server.mjs'), 'utf8')).toBe('server')
    expect(existsSync(join(stage, 'server', 'drizzle', '0000_init.sql'))).toBe(true)
    // The web app comes from the web build, never the server dist's leftover copy.
    expect(await readFile(join(stage, 'server', 'web', 'index.html'), 'utf8')).toBe('app')
    expect(existsSync(join(stage, 'pg', 'share', 'extension', 'plpgsql.control'))).toBe(true)
    // Only what the zip lacks is added: its own msvcp140.dll stays.
    expect(await readFile(join(stage, 'pg', 'bin', 'msvcp140.dll'), 'utf8')).toBe('from the zip')
    expect(await readFile(join(stage, 'pg', 'bin', 'vcruntime140.dll'), 'utf8')).toBe('vc')
    expect(result.addedVcRuntime).toEqual(['vcruntime140.dll', 'vcruntime140_1.dll'])

    const sidecar = join(root, 'src-tauri', 'binaries', 'mawl-server-x86_64-pc-windows-gnu.exe')
    expect(await readFile(sidecar, 'utf8')).toBe('node binary')
    expect(result).toMatchObject({ sidecar, nodeVersion: '24.19.0' })

    // Inputs are checked before the slow builds start.
    expect(run.calls).toEqual([
      [inputs.node, '-v'],
      ['pnpm', '--filter', '@mawl/server', 'build'],
      ['pnpm', '--filter', '@mawl/web', 'build'],
    ])
    expect(await checkStage(inputs.srcTauri, inputs.webDist, inputs.triple)).toEqual([])
  })

  it('replaces an earlier stage whole, so no stale file survives', async () => {
    const inputs = await fixture()
    await put('src-tauri/bundle-stage/server/stale.mjs')
    await assembleStage(inputs, fakeRun())
    expect(existsSync(join(root, 'src-tauri', 'bundle-stage', 'server', 'stale.mjs'))).toBe(false)
  })

  it('skips the builds when asked', async () => {
    const run = fakeRun()
    await assembleStage({ ...(await fixture()), skipBuild: true }, run)
    expect(run.calls.map((c) => c[0])).not.toContain('pnpm')
  })

  it('keeps the earlier stage when the sidecar node is the wrong major', async () => {
    const inputs = await fixture()
    await put('src-tauri/bundle-stage/server/server.mjs', 'previous')
    await expect(assembleStage(inputs, fakeRun('v25.0.0'))).rejects.toThrow(/\.nvmrc wants 24/)
    expect(await readFile(join(root, 'src-tauri/bundle-stage/server/server.mjs'), 'utf8')).toBe(
      'previous',
    )
    expect(existsSync(join(root, 'src-tauri', 'binaries'))).toBe(false)
  })

  it('refuses a Postgres dir that fetch-pg.ps1 did not make', async () => {
    const inputs = await fixture()
    await rm(join(root, 'pg', '.mawl-pg-bundle'))
    await expect(assembleStage(inputs, fakeRun())).rejects.toThrow(/fetch-pg\.ps1/)
  })

  it('fails without a complete VC++ runtime and names where it looked', async () => {
    const inputs = await fixture()
    await expect(
      assembleStage({ ...inputs, vcRuntimeDirs: [join(root, 'nowhere')] }, fakeRun()),
    ).rejects.toThrow(/VC\+\+ runtime.*nowhere/s)
  })
})

describe('checking a stage before tauri build', () => {
  it('lists the missing stage files, the sidecar for the triple and the splash', async () => {
    const srcTauri = join(root, 'src-tauri')
    const problems = await checkStage(srcTauri, join(root, 'web'), 'x86_64-pc-windows-msvc')
    expect(problems).toContain('bundle-stage/server/server.mjs')
    expect(problems).toContain('binaries/mawl-server-x86_64-pc-windows-msvc.exe')
    expect(problems).toContain(join(root, 'web', 'splash.html'))
  })
})
