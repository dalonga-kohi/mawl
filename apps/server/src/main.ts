import { runMain } from './run-main.ts'

runMain({
  env: process.env,
  stdin: () => process.stdin,
  proc: process,
  exit: (code) => process.exit(code),
  stderr: process.stderr,
})
