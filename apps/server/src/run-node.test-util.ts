import { spawn } from 'node:child_process'

/** Runs node with `args` and resolves with the exit code and combined stdout+stderr. */
export function runNode(
  args: string[],
  opts: { cwd: string; env: Record<string, string> },
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: opts.cwd,
      env: { PATH: process.env.PATH ?? '', ...opts.env },
    })
    const chunks: string[] = []
    child.stdout.on('data', (d) => chunks.push(String(d)))
    child.stderr.on('data', (d) => chunks.push(String(d)))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, output: chunks.join('') }))
  })
}
