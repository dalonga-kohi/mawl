import { configDefaults, defineProject } from 'vitest/config'

// Travis runs the Docker suites (.travis.yml); the fast GitHub gate sets MAWL_SKIP_DOCKER_SUITES.
const skipDocker = ['1', 'true'].includes(process.env.MAWL_SKIP_DOCKER_SUITES ?? '')

export default defineProject({
  // PGlite suites boot WASM Postgres per file; under parallel load that can pass 5 s.
  test: {
    name: '@mawl/db',
    exclude: [...configDefaults.exclude, ...(skipDocker ? ['**/*.pg.test.ts'] : [])],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
