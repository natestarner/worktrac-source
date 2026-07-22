import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.jsx'
import { loadConfig } from './config'

// Register the service worker that precaches the app shell for offline cold-loads. With
// registerType:'prompt' a newly-deployed build is fetched but NOT applied automatically -- we stash
// the update function and let ServiceWorkerUpdater ask the user to reload, so a running workout is
// never interrupted by a surprise refresh. This import resolves to a no-op in `vite dev`
// (devOptions disabled) and is never pulled into the Vitest bundle (main.jsx isn't imported by tests
// and the plugin is excluded there).
const updateSW = registerSW({
  onNeedRefresh() {
    window.__pwaUpdateSW = updateSW
    window.dispatchEvent(new Event('pwa:needrefresh'))
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
