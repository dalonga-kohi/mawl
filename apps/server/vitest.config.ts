import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: '@faire/server',
    // The PGlite suites migrate in beforeEach; with turbo running every package at once that can
    // pass the 10 s default on a loaded machine.
    hookTimeout: 60_000,
  },
})
