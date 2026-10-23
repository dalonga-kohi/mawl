import { defineProject } from 'vitest/config'

// The compose smoke test builds the server image and boots the stack (about a minute), so the
// default config excludes it and `pnpm test:compose` runs it alone through this config.
export default defineProject({
  test: {
    name: '@mawl/server compose',
    include: ['src/compose.smoke.test.ts'],
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
})
