import { EventEmitter } from 'node:events'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { Clock, PgChild, SpawnFn, SpawnOpts } from './process.ts'

/** A scripted child process for unit tests: exits when told to, records kills. */
export class FakeChild extends EventEmitter implements PgChild {
  static nextPid = 1000
  readonly pid = FakeChild.nextPid++
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly kills: (NodeJS.Signals | number | undefined)[] = []
  /** What a kill does; by default the process dies at once. */
  onKill: () => void = () => this.exit(null, 'SIGTERM')

  constructor(
    readonly command: string,
    readonly args: readonly string[],
    readonly opts: SpawnOpts,
  ) {
    super()
  }

  kill(signal?: NodeJS.Signals | number): boolean {
    this.kills.push(signal)
    if (this.exitCode === null && this.signalCode === null) this.onKill()
    return true
  }

  /** Exits on a later tick, as a real process would. */
  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    setImmediate(() => {
      if (this.exitCode !== null || this.signalCode !== null) return
      this.exitCode = code
      this.signalCode = signal
      this.stdout.end()
      this.stderr.end()
      this.emit('exit', code, signal)
    })
  }
}

export type FakeBehaviour = (child: FakeChild) => void

export interface FakeSpawn {
  spawn: SpawnFn
  children: FakeChild[]
  /** Children whose command is `<pgRoot>/bin/<name>[.exe]`. */
  of(name: string): FakeChild[]
}

const baseName = (cmd: string) => (cmd.split(/[\\/]/).pop() ?? cmd).replace(/\.exe$/, '') as string

/** Routes each spawn to the behaviour registered for its binary name. */
export function fakeSpawn(behaviours: Record<string, FakeBehaviour>): FakeSpawn {
  const children: FakeChild[] = []
  const spawn: SpawnFn = (command, args, opts) => {
    const child = new FakeChild(command, args, opts)
    children.push(child)
    const behave = behaviours[baseName(command)]
    if (!behave) throw new Error(`no fake behaviour for ${command}`)
    behave(child)
    return child
  }
  return { spawn, children, of: (name) => children.filter((c) => baseName(c.command) === name) }
}

export const argValue = (args: readonly string[], flag: string): string | undefined =>
  args.find((a) => a.startsWith(`${flag}=`))?.slice(flag.length + 1)

/** initdb that writes a minimal PG 17 cluster into --pgdata and exits 0. */
export const fakeInitdbOk =
  (seen?: { password?: string }): FakeBehaviour =>
  (child) => {
    void (async () => {
      const dir = argValue(child.args, '--pgdata')
      const pwfile = argValue(child.args, '--pwfile')
      if (!dir || !pwfile) throw new Error('initdb args missing')
      if (seen) seen.password = (await readFile(pwfile, 'utf8')).trim()
      await mkdir(join(dir, 'global'), { recursive: true })
      await writeFile(join(dir, 'PG_VERSION'), '17\n')
      await writeFile(join(dir, 'global', 'pg_control'), 'x')
      await writeFile(join(dir, 'postgresql.conf'), '')
      child.stdout.write('Success.\n')
      child.exit(0)
    })()
  }

export interface FakeClock extends Clock {
  /** Every sleep requested, in order. */
  slept: number[]
  /** Moves time forward and wakes the long sleeps that are due. */
  advance(ms: number): void
}

/**
 * Virtual time. Short sleeps (poll intervals, at most `autoMs`) advance the clock themselves and
 * resolve on the next macrotask, so polling loops run without real waiting. Long sleeps (timeouts)
 * stay pending until the test calls `advance`, so a timeout only fires when a test means it to.
 */
export function fakeClock({ autoMs = 1_000 }: { autoMs?: number } = {}): FakeClock {
  let t = 0
  const slept: number[] = []
  const pending: { due: number; resolve: () => void }[] = []
  const wake = () => {
    for (const p of pending.filter((x) => x.due <= t)) {
      pending.splice(pending.indexOf(p), 1)
      p.resolve()
    }
  }
  return {
    slept,
    now: () => t,
    advance(ms) {
      t += ms
      wake()
    },
    sleep: (ms) =>
      new Promise((resolve) => {
        slept.push(ms)
        if (ms <= autoMs) {
          t += ms
          setImmediate(() => {
            wake()
            resolve()
          })
        } else {
          pending.push({ due: t + ms, resolve })
        }
      }),
  }
}
