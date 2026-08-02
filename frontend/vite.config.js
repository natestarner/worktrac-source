import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// The service worker is what lets the app cold-load with no network (precached shell + assets).
// It is deliberately kept OUT of the Vitest run (the plugin injects a build-only virtual module and
// SW machinery that unit tests neither need nor can execute) and OUT of `vite dev` via
// devOptions.enabled:false, so it can't interfere with the shared-port local dev flow. Exercise it
// against a production build: `npm run build && npm run preview`.
const isTest = process.env.VITEST

// Shared by the dev server and `vite preview` so both reach the local backend identically.
// Both the port and the backend origin are overridable via env vars so each git worktree can
// run its own fully isolated stack (see scripts/worktree-env.sh) -- default to the historical
// 3000/:8080 pairing so a plain `npm run dev` with no env vars set behaves exactly as before.
const FRONTEND_PORT = Number(process.env.FRONTEND_PORT) || 3000
const BACKEND_ORIGIN = process.env.VITE_BACKEND_ORIGIN || 'http://localhost:8080'
const devProxy = {
  '/api': { target: BACKEND_ORIGIN, changeOrigin: true },
  '/actuator': { target: BACKEND_ORIGIN, changeOrigin: true },
}

const pwaPlugin = VitePWA({
  registerType: 'prompt', // never auto-reload mid-workout; ServiceWorkerUpdater prompts instead
  injectRegister: null, // we call registerSW() ourselves in main.jsx
  manifest: false, // keep the existing hand-written public/manifest.webmanifest
  workbox: {
    globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,woff,woff2}'],
    navigateFallback: '/index.html',
    // Never hand app-shell HTML to API/health calls; let those hit the network (and fail cleanly
    // offline, which the app handles) instead of being answered with index.html.
    navigateFallbackDenylist: [/^\/api\//, /^\/actuator\//, /^\/config\.json$/],
    runtimeCaching: [
      {
        // Runtime config: serve fresh when online so a changed apiUrl still updates, but fall back
        // to the last-known copy offline so the cold boot in main.jsx isn't blocked.
        urlPattern: ({ url }) => url.pathname === '/config.json',
        handler: 'NetworkFirst',
        options: { cacheName: 'runtime-config', expiration: { maxEntries: 1 } },
      },
    ],
    // Do NOT cache /api responses -- the TanStack Query cache owns data; a second SW cache would
    // fight invalidation and serve stale reads.
  },
  devOptions: { enabled: false },
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), ...(isTest ? [] : [pwaPlugin])],
  // Vitest's transform pipeline falls back to esbuild's default (classic) JSX runtime
  // for .jsx files that Babel doesn't already handle, which needs React in scope --
  // unlike the app's own components, which rely on the automatic runtime everywhere and
  // never import React. Pin esbuild to the same automatic runtime so component tests
  // don't need a React import just to satisfy the test transform.
  esbuild: {
    jsx: 'automatic',
  },
  server: {
    port: FRONTEND_PORT,
    proxy: devProxy
  },
  // `vite preview` serves the PRODUCTION build -- the only build that includes the service worker --
  // so it's how you exercise offline cold-load locally: `npm run build && npm run preview`. Kept on
  // the SAME port as `server` above (the only CORS-allowed origin for this worktree, per
  // CORS_ALLOWED_ORIGINS) with the same /api proxy target. Note: after preview testing, unregister
  // the service worker in DevTools before running `vite dev` again on this port, or the stale SW
  // will keep serving cached assets over the dev server.
  preview: {
    port: FRONTEND_PORT,
    proxy: devProxy
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.js'
  }
})
