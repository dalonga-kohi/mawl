// Test only (main.test.ts runs it with tsx; never bundled). The real desktop entrypoint, runMain
// on the real process stdin, signals and HTTP listener, over a fake database so the parent
// watchdog can be tested end to end without Postgres or Docker.
import type { DbHandle } from '@mawl/db'
import { runMain } from './run-main.ts'
import { startServer } from './server.ts'

const handle = {
  db: {},
  pool: { connect: async () => ({ query: async () => ({ rows: [] }), release() {} }) },
  close: async () => {},
} as unknown as DbHandle

runMain({
  env: process.env,
  stdin: () => process.stdin,
  proc: process,
  exit: (code) => process.exit(code),
  stderr: process.stderr,
  startServer: (config, overrides) =>
    startServer(config, {
      ...overrides,
      createDb: () => handle,
      migrate: async () => {},
      worker: false,
      events: false,
    }),
})
