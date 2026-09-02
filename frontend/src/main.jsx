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
//
// The controllerchange -> reload transition this triggers (inside registerSW's own updateSW
// implementation) is still an open investigation as of 2026-08-31/09-01: a white-screen report
// recurred specifically on this codepath even after config.js's apiUrl fallback was fixed
// (PR #216), and it could not be reproduced via page.reload()/page.goto() against an
// already-controlling worker -- see docs/incidents/2026-08-31-boot-white-screen-recurrence.md's
// second follow-up. This comment exists to force a genuinely new service-worker version to exist
// on lower so that transition can be tested for real, rather than simulated.
// Boot breadcrumbs for boot-watchdog.js. Reaching this line means the whole module graph evaluated
// -- so if the watchdog later fires WITHOUT this mark, the failure was upstream of any app code
// (the bundle never loaded, or a module-evaluation throw), which no React boundary could ever have
// caught and which nothing else in the app can distinguish. Optional-called: the global only exists
// if the watchdog itself loaded, and the diagnostic must never become a boot dependency.
window.__huddleBootMark?.('bundle')

const updateSW = registerSW({
  onRegisteredSW(_swUrl, registration) {
    startUpdatePolling(registration)
  },
  onNeedRefresh() {
    markUpdateAvailable(updateSW)
  },
})

loadConfig().then(() => {
  // The other half of the split: `bundle` without `render` means loadConfig never settled, which is
  // the one boot step that blocks createRoot entirely (see config.js). With both marks present and
  // still no paint, the failure is inside React's first render.
  window.__huddleBootMark?.('render')
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  )
})
