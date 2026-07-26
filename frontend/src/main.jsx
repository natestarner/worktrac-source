import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.jsx'
import { loadConfig } from './config'
import { markUpdateAvailable, startUpdatePolling } from './lib/swUpdate'

// Register the service worker that precaches the app shell for offline cold-loads. With
// registerType:'prompt' a newly-deployed build is fetched but NOT applied automatically --
// swUpdate.js stashes the update function and both ServiceWorkerUpdater (a dismissible banner) and
// AppShell/LogTab's forced-reload triggers (person/section/exercise switch, ending a workout, tab
// visibility regained) can apply it, guarded so a running workout is never interrupted mid-write.
// This import resolves to a no-op in `vite dev` (devOptions disabled) and is never pulled into the
// Vitest bundle (main.jsx isn't imported by tests and the plugin is excluded there).
const updateSW = registerSW({
  onRegisteredSW(_swUrl, registration) {
    startUpdatePolling(registration)
  },
  onNeedRefresh() {
    markUpdateAvailable(updateSW)
  },
})

loadConfig().then(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  )
})
