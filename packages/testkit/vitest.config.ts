import { configDefaults, defineProject } from 'vitest/config'

// Travis runs the Docker suites (.travis.yml); the fast GitHub gate sets MAWL_SKIP_DOCKER_SUITES.
const skipDocker = ['1', 'true'].includes(process.env.MAWL_SKIP_DOCKER_SUITES ?? '')

export default defineProject({
  test: {
    name: '@mawl/testkit',
    exclude: [...configDefaults.exclude, ...(skipDocker ? ['**/postgres.smoke.test.ts'] : [])],
  },
})
