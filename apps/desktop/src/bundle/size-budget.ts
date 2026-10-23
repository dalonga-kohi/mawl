// The installer size budget (PLAN D1.7a): the NSIS setup must stay at or under 60 MiB. D0.2
// measured 46.35 MiB without the Claude binary, which is downloaded on first use instead.
//
//   node src/bundle/size-budget.ts [<setup.exe or bundle dir> ...]
//
// With no argument it checks `src-tauri/target/release/bundle` and the per-triple release bundle
// dirs. Exits 1 when an installer is over the budget or none is found.
import { readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

export const INSTALLER_BUDGET_BYTES = 60 * 1024 * 1024

export interface SizeCheck {
  path: string
  bytes: number
  ok: boolean
  message: string
}

const mib = (bytes: number) => (bytes / (1024 * 1024)).toFixed(2)

export async function checkInstallerSize(
  path: string,
  budget = INSTALLER_BUDGET_BYTES,
): Promise<SizeCheck> {
  const { size: bytes } = await stat(path)
  const ok = bytes <= budget
  const budgetMiB = budget / (1024 * 1024)
  const message = ok
    ? `${path} is ${mib(bytes)} MiB of ${budgetMiB} MiB`
    : `${path} is ${mib(bytes)} MiB, over the ${budgetMiB} MiB budget`
  return { path, bytes, ok, message }
}

/** The NSIS setup executables in `<bundleDir>/nsis`; none when the dir is missing. */
export async function findInstallers(bundleDir: string): Promise<string[]> {
  const nsis = join(bundleDir, 'nsis')
  let names: string[]
  try {
    names = await readdir(nsis)
  } catch {
    return []
  }
  return names
    .filter((name) => name.toLowerCase().endsWith('-setup.exe'))
    .sort()
    .map((name) => join(nsis, name))
}

async function main(args: string[]): Promise<number> {
  const target = resolve(import.meta.dirname, '../../src-tauri/target')
  const inputs =
    args.length > 0
      ? args.map((a) => resolve(a))
      : [
          join(target, 'release', 'bundle'),
          join(target, 'x86_64-pc-windows-msvc', 'release', 'bundle'),
          join(target, 'x86_64-pc-windows-gnu', 'release', 'bundle'),
        ]
  const installers: string[] = []
  for (const input of inputs) {
    const info = await stat(input).catch(() => undefined)
    if (info?.isFile()) installers.push(input)
    else if (info?.isDirectory()) installers.push(...(await findInstallers(input)))
  }
  if (installers.length === 0) {
    process.stderr.write(`no NSIS installer found in: ${inputs.join(', ')}\n`)
    return 1
  }
  let failed = false
  for (const installer of installers) {
    const check = await checkInstallerSize(installer)
    ;(check.ok ? process.stdout : process.stderr).write(`${check.message}\n`)
    failed ||= !check.ok
  }
  return failed ? 1 : 0
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2))
}
