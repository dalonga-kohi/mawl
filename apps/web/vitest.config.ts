import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// This file is both the Vite config (`vite --config vitest.config.ts`) and the Vitest project:
// the workspace convention typechecks only `src` and `vitest.config.ts`.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    // The dev server talks to a local faire-server; the built app is served by the server itself.
    proxy: {
      '/rpc': 'http://127.0.0.1:7420',
      // Host stays localhost:5173, which the server's Host allowlist accepts as loopback.
      '/ws': { target: 'ws://127.0.0.1:7420', ws: true },
    },
  },
  test: {
    name: '@faire/web',
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
