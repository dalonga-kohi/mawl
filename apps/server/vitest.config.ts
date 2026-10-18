import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: '@faire/server',
    // The PGlite suites migrate in beforeEach; with turbo running every package at once that can
    // pass the 10 s default on a loaded machine.
    hookTimeout: 60_000,
    // The intermittent full-gate failure was default 5 s tests (key files, boot edge cases) starved
    // by the heavy suites running beside them (PGlite WASM, Docker, esbuild, tsx child processes).
    // Each passes in well under 1 s alone, so the cap only matters on a loaded machine.
    testTimeout: 30_000,
  },
})
