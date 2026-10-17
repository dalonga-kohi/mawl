import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      'packages/*',
      'apps/*',
      {
        extends: false,
        test: { name: 'workspace', include: ['scripts/**/*.test.ts'] },
      },
    ],
  },
})
