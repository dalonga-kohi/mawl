import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { missingFromStage, PG_MARKER_TEXT } from './layout.ts'
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
const read = (path: string) => readFile(join(root, path), 'utf8')

/** Writes the three pgvector files flat in `dir` with a matching SHA256SUMS.txt. */
async function pgvectorArtifact(dir: string, sums = true): Promise<void> {
  const files = { 'vector.control': 'control', 'vector.dll': 'dll', 'vector--0.8.7.sql': 'sql' }
  for (const [name, content] of Object.entries(files)) await put(`${dir}/${name}`, content)
  if (sums) {
    await put(
      `${dir}/SHA256SUMS.txt`,
      Object.entries(files)
        .map(([name, content]) => `${sha256(content)}  ${name}`)
        .join('\n'),
    )
  }
}

describe('pgvector files', () => {
  it('takes the flat MSVC artifact layout after checking SHA256SUMS.txt', async () => {
    await pgvectorArtifact('vec')
    expect(await resolvePgvectorFiles(join(root, 'vec'))).toEqual({
      dll: join(root, 'vec', 'vector.dll'),
      control: join(root, 'vec', 'vector.control'),
      sql: join(root, 'vec', 'vector--0.8.7.sql'),
    })
  })

  it('refuses a file that does not match SHA256SUMS.txt', async () => {
    await pgvectorArtifact('vec')
    await put('vec/vector.dll', 'tampered')
    await expect(resolvePgvectorFiles(join(root, 'vec'))).rejects.toThrow(
      /vector\.dll does not match SHA256SUMS\.txt/,
    )
  })

  it('refuses files without a SHA256SUMS.txt', async () => {
    await pgvectorArtifact('vec', false)
    await expect(resolvePgvectorFiles(join(root, 'vec'))).rejects.toThrow(
      /SHA256SUMS\.txt is missing/,
    )
  })

  it('refuses a SHA256SUMS.txt that does not list every file', async () => {
    await pgvectorArtifact('vec', false)
    await put(
      'vec/SHA256SUMS.txt',
      `${sha256('dll')}  vector.dll\n${sha256('control')}  vector.control\n`,
    )
    await expect(resolvePgvectorFiles(join(root, 'vec'))).rejects.toThrow(
      /no SHA256SUMS\.txt entry for vector--0\.8\.7\.sql/,
    )
  })

  it('also takes a Postgres root with the extension installed (the MinGW fallback)', async () => {
    await put('pgroot/lib/vector.dll', 'dll')
    await put('pgroot/share/extension/vector.control', 'control')
    await put('pgroot/share/extension/vector--0.8.7.sql', 'sql')
    await put(
      'pgroot/SHA256SUMS.txt',
      `${sha256('dll')} *vector.dll\n${sha256('control')}  vector.control\n${sha256('sql')}  vector--0.8.7.sql\n`,
    )
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

const STAGE = 'src-tauri/bundle-stage'
const SIDECAR = `${STAGE}/binaries/mawl-server-x86_64-pc-windows-gnu.exe`

async function fixture(): Promise<StageInputs> {
  await put('server/dist/server.mjs', 'server')
  await put('server/dist/drizzle/meta/_journal.json', '{}')
  await put('server/dist/drizzle/0000_init.sql', 'sql')
  await put('server/dist/web/index.html', 'stale docker web copy')
  await put('web/dist/index.html', 'app')
  await put('web/dist/splash.html', 'splash')
  await put('web/dist/assets/app.js', 'js')
  await put('pg/.mawl-pg-bundle', PG_MARKER_TEXT)
  await put('pg/server_license.txt', 'license')
  for (const exe of ['postgres.exe', 'initdb.exe', 'pg_ctl.exe']) await put(`pg/bin/${exe}`)
  await put('pg/bin/msvcp140.dll', 'from the zip')
  await put('pg/share/extension/plpgsql.control')
  await pgvectorArtifact('vec')
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

/** A stage from an earlier run, to prove a failed run leaves it alone. */
async function earlierStage(): Promise<void> {
  await put(`${STAGE}/server/server.mjs`, 'previous')
  await put(SIDECAR, 'previous node')
}

function fakeRun(nodeVersion = 'v24.19.0'): Run & { calls: string[][] } {
  const calls: string[][] = []
  const run: Run = async (cmd, args) => {
    calls.push([cmd, ...args])
    return args[0] === '-v' ? `${nodeVersion}\n` : ''
  }
  return Object.assign(run, { calls })
}

async function expectEarlierStageKept(): Promise<void> {
  expect(await read(`${STAGE}/server/server.mjs`)).toBe('previous')
  expect(await read(SIDECAR)).toBe('previous node')
  expect(existsSync(join(root, `${STAGE}.next`))).toBe(false)
}

describe('assembling the stage', () => {
  it('builds the server and web app, then lays out the bundle the host expects', async () => {
    const inputs = await fixture()
    const run = fakeRun()
    const result = await assembleStage(inputs, run)

    const stage = join(root, STAGE)
    expect(missingFromStage(stage, existsSync)).toEqual([])
    expect(await read(`${STAGE}/server/server.mjs`)).toBe('server')
    expect(existsSync(join(stage, 'server', 'drizzle', '0000_init.sql'))).toBe(true)
    // The web app comes from the web build, never the server dist's leftover copy.
    expect(await read(`${STAGE}/server/web/index.html`)).toBe('app')
    expect(existsSync(join(stage, 'pg', 'share', 'extension', 'plpgsql.control'))).toBe(true)
    expect(await read(`${STAGE}/pg/server_license.txt`)).toBe('license')
    // fetch-pg's marker is cache bookkeeping, not part of the install.
    expect(existsSync(join(stage, 'pg', '.mawl-pg-bundle'))).toBe(false)
    // Only what the zip lacks is added: its own msvcp140.dll stays.
    expect(await read(`${STAGE}/pg/bin/msvcp140.dll`)).toBe('from the zip')
    expect(await read(`${STAGE}/pg/bin/vcruntime140.dll`)).toBe('vc')
    expect(result.addedVcRuntime).toEqual(['vcruntime140.dll', 'vcruntime140_1.dll'])

    // The sidecar is part of the stage and swapped in with it.
    expect(await read(SIDECAR)).toBe('node binary')
    expect(result).toMatchObject({ sidecar: join(root, SIDECAR), nodeVersion: '24.19.0' })
    expect(existsSync(join(root, 'src-tauri', 'binaries'))).toBe(false)

    const record = JSON.parse(await read(`${STAGE}/stage.json`))
    expect(record).toMatchObject({
      triple: 'x86_64-pc-windows-gnu',
      node: '24.19.0',
      postgres: PG_MARKER_TEXT,
      web: { 'index.html': sha256('app'), 'splash.html': sha256('splash') },
      vcRuntime: {
        from: join(root, 'vc'),
        system: false,
        added: [
          { name: 'vcruntime140.dll', path: join(root, 'vc', 'vcruntime140.dll'), version: null },
          {
            name: 'vcruntime140_1.dll',
            path: join(root, 'vc', 'vcruntime140_1.dll'),
            version: null,
          },
        ],
      },
    })

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
    await earlierStage()
    await put(`${STAGE}/server/stale.mjs`)
    await assembleStage(inputs, fakeRun())
    expect(existsSync(join(root, STAGE, 'server', 'stale.mjs'))).toBe(false)
    expect(await read(SIDECAR)).toBe('node binary')
  })

  it('skips the builds when asked', async () => {
    const run = fakeRun()
    await assembleStage({ ...(await fixture()), skipBuild: true }, run)
    expect(run.calls.map((c) => c[0])).not.toContain('pnpm')
  })

  it('stops before any build when the sidecar node is the wrong major', async () => {
    const inputs = await fixture()
    await earlierStage()
    const run = fakeRun('v25.0.0')
    await expect(assembleStage(inputs, run)).rejects.toThrow(/\.nvmrc wants 24/)
    expect(run.calls.map((c) => c[0])).not.toContain('pnpm')
    await expectEarlierStageKept()
  })

  it('keeps the earlier stage when the new one is incomplete', async () => {
    const inputs = await fixture()
    await earlierStage()
    await rm(join(root, 'pg', 'bin', 'initdb.exe'))
    await expect(assembleStage(inputs, fakeRun())).rejects.toThrow(
      /the stage is incomplete: pg\/bin\/initdb\.exe/,
    )
    await expectEarlierStageKept()
  })

  it('restores the earlier stage when the new one cannot be moved into place', async () => {
    const inputs = await fixture()
    await earlierStage()
    const failing: typeof rename = async (from, to) => {
      if (String(from).endsWith('.next')) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' })
      return rename(from, to)
    }
    await expect(assembleStage(inputs, fakeRun(), { rename: failing })).rejects.toThrow(/EBUSY/)
    await expectEarlierStageKept()
    expect(existsSync(join(root, `${STAGE}.old`))).toBe(false)
  })

  it('only warns when the old stage cannot be deleted after the swap', async () => {
    const inputs = await fixture()
    await earlierStage()
    const warnings: string[] = []
    const failing: typeof rm = async (path, options) => {
      if (String(path).endsWith('.old') && existsSync(String(path))) throw new Error('EPERM')
      return rm(path, options)
    }
    const result = await assembleStage(inputs, fakeRun(), {
      rm: failing,
      warn: (m) => warnings.push(m),
    })
    expect(await read(SIDECAR)).toBe('node binary')
    expect(result.stage).toBe(join(root, STAGE))
    expect(warnings.join('\n')).toMatch(/bundle-stage\.old.*EPERM/)
  })

  it('refuses a Postgres dir without the fetch-pg.ps1 marker', async () => {
    const inputs = await fixture()
    await rm(join(root, 'pg', '.mawl-pg-bundle'))
    await expect(assembleStage(inputs, fakeRun())).rejects.toThrow(/fetch-pg\.ps1/)
  })

  it('refuses a Postgres dir whose marker names another version or zip', async () => {
    const inputs = await fixture()
    await put('pg/.mawl-pg-bundle', 'postgresql 17.10-1 F9AA')
    await expect(assembleStage(inputs, fakeRun())).rejects.toThrow(
      /marker.*postgresql 17\.10-1 F9AA.*expected/s,
    )
  })
})

describe('the VC++ runtime from System32', () => {
  async function system32(): Promise<string> {
    for (const dll of ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll']) {
      await put(`sys32/${dll}`, 'system')
    }
    return join(root, 'sys32')
  }

  it('is refused unless allowed, with a message that says how to fix it', async () => {
    const inputs = await fixture()
    await expect(
      assembleStage(
        { ...inputs, vcRuntimeDirs: [join(root, 'nowhere')], systemDir: await system32() },
        fakeRun(),
      ),
    ).rejects.toThrow(/VC\+\+ runtime.*nowhere.*--vc-runtime.*--allow-system-vc/s)
  })

  it('is used when allowed on x64, and recorded as such', async () => {
    const inputs = await fixture()
    const result = await assembleStage(
      {
        ...inputs,
        vcRuntimeDirs: [],
        systemDir: await system32(),
        allowSystemVc: true,
        arch: 'x64',
      },
      fakeRun(),
    )
    expect(result.vcRuntimeDir).toBe(join(root, 'sys32'))
    expect(await read(`${STAGE}/pg/bin/vcruntime140.dll`)).toBe('system')
    const record = JSON.parse(await read(`${STAGE}/stage.json`))
    expect(record.vcRuntime).toMatchObject({ from: join(root, 'sys32'), system: true })
  })

  it('is refused on a non-x64 machine, whose System32 holds other DLLs', async () => {
    const inputs = await fixture()
    await expect(
      assembleStage(
        {
          ...inputs,
          vcRuntimeDirs: [],
          systemDir: await system32(),
          allowSystemVc: true,
          arch: 'arm64',
        },
        fakeRun(),
      ),
    ).rejects.toThrow(/System32.*x64.*arm64/s)
  })
})

describe('checking a stage before tauri build', () => {
  it('lists the missing stage files, the sidecar for the triple and the splash', async () => {
    const srcTauri = join(root, 'src-tauri')
    const problems = await checkStage(srcTauri, join(root, 'web'), 'x86_64-pc-windows-msvc')
    expect(problems).toContain('bundle-stage/server/server.mjs')
    expect(problems).toContain('bundle-stage/binaries/mawl-server-x86_64-pc-windows-msvc.exe')
    expect(problems).toContain(join(root, 'web', 'splash.html'))
    expect(problems).toContain('bundle-stage/stage.json')
  })

  it('catches a web build that changed after staging', async () => {
    const inputs = await fixture()
    await assembleStage(inputs, fakeRun())
    await put('web/dist/splash.html', 'rebuilt splash')
    const problems = await checkStage(inputs.srcTauri, inputs.webDist, inputs.triple)
    expect(problems).toEqual([expect.stringMatching(/splash\.html changed since the stage/)])
  })
})
