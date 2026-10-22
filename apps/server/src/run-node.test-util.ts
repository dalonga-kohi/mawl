import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'

export interface NodeProcess {
  child: ChildProcessWithoutNullStreams
  /** Combined stdout+stderr so far. */
  output(): string
  /** Exit code once the process has exited and its streams closed. */
  exited: Promise<number | null>
  /** Resolves once the output matches, rejects if the process exits first. */
  waitForOutput(pattern: RegExp): Promise<void>
}

/** Spawns node with `args` and piped stdio, for tests that talk to the process while it runs. */
export function spawnNode(
  args: string[],
  opts: { cwd: string; env: Record<string, string> },
): NodeProcess {
  const child = spawn(process.execPath, args, {
    cwd: opts.cwd,
    env: { PATH: process.env.PATH ?? '', ...opts.env },
  })
  const chunks: string[] = []
  const watchers = new Set<() => void>()
  const onData = (d: unknown) => {
    chunks.push(String(d))
    for (const w of watchers) w()
  }
  child.stdout.on('data', onData)
  child.stderr.on('data', onData)
  const exited = new Promise<number | null>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code) => resolve(code))
  })
  const output = () => chunks.join('')
  return {
    child,
    output,
    exited,
    waitForOutput: (pattern) =>
      new Promise((resolve, reject) => {
        const check = () => {
          if (!pattern.test(output())) return
          watchers.delete(check)
          resolve()
        }
        watchers.add(check)
        check()
        exited.then(
          () => reject(new Error(`exited before output matched ${pattern}:\n${output()}`)),
          reject,
        )
      }),
  }
}

/**
 * Runs node with `args` and resolves with the exit code and combined stdout+stderr. `stdin` is
 * written and then closed; without it stdin is closed at once.
 */
export async function runNode(
  args: string[],
  opts: { cwd: string; env: Record<string, string>; stdin?: string },
): Promise<{ code: number | null; output: string }> {
  const proc = spawnNode(args, opts)
  proc.child.stdin.on('error', () => {}) // the child may exit before reading
  proc.child.stdin.end(opts.stdin ?? '')
  const code = await proc.exited
  return { code, output: proc.output() }
}
