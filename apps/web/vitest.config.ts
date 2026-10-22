import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'

// The mawl-server the dev server talks to. Playwright points it at its own e2e server.
const devServer = process.env.MAWL_DEV_SERVER || 'http://127.0.0.1:7420'

// This file is both the Vite config (`vite --config vitest.config.ts`) and the Vitest project:
// the workspace convention typechecks only `src` and `vitest.config.ts`.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // The app, and the desktop splash the Tauri host loads from its own origin (D1.5).
    rolldownOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        splash: resolve(import.meta.dirname, 'splash.html'),
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    // The dev server talks to a local mawl-server; the built app is served by the server itself.
    proxy: {
      '/rpc': devServer,
      // Host stays localhost:5173, which the server's Host allowlist accepts as loopback.
      '/ws': { target: devServer.replace(/^http/, 'ws'), ws: true },
    },
  },
  test: {
    name: '@mawl/web',
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // `beforeAll(() => import('./ChatView.tsx'))` pulls in the whole chat tree; on a cold cache
    // that exceeded the 10 s default hook timeout.
    hookTimeout: 60_000,
    testTimeout: 30_000,
    // Playwright owns e2e/: its specs must never run under Vitest.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
})
