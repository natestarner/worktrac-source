import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Vitest's transform pipeline falls back to esbuild's default (classic) JSX runtime
  // for .jsx files that Babel doesn't already handle, which needs React in scope --
  // unlike the app's own components, which rely on the automatic runtime everywhere and
  // never import React. Pin esbuild to the same automatic runtime so component tests
  // don't need a React import just to satisfy the test transform.
  esbuild: {
    jsx: 'automatic',
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true
      },
      '/actuator': {
        target: 'http://localhost:8080',
        changeOrigin: true
      }
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.js'
  }
})
