import { defineProject } from 'vitest/config'

export default defineProject({
  // PGlite suites boot WASM Postgres per file; under parallel load that can pass 5 s.
  test: { name: '@faire/db', testTimeout: 30_000, hookTimeout: 30_000 },
})
