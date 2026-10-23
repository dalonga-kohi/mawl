import { configDefaults, defineProject } from 'vitest/config'

// Travis runs the Docker suites (.travis.yml); the fast GitHub gate sets MAWL_SKIP_DOCKER_SUITES.
const skipDocker = ['1', 'true'].includes(process.env.MAWL_SKIP_DOCKER_SUITES ?? '')

export default defineProject({
  test: {
    name: '@mawl/server',
    exclude: [
      ...configDefaults.exclude,
      // Builds the Docker image; runs through `pnpm test:compose` (vitest.compose.config.ts).
      '**/compose.smoke.test.ts',
      ...(skipDocker ? ['**/*.pg.test.ts'] : []),
    ],
    // The PGlite suites migrate in beforeEach; with turbo running every package at once that can
    // pass the 10 s default on a loaded machine.
    hookTimeout: 60_000,
    // The intermittent full-gate failure was default 5 s tests (key files, boot edge cases) starved
    // by the heavy suites running beside them (PGlite WASM, Docker, esbuild, tsx child processes).
    // Each passes in well under 1 s alone, so the cap only matters on a loaded machine.
    testTimeout: 30_000,
  },
})
