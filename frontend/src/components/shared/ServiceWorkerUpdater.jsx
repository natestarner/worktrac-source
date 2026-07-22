import { useEffect, useState } from 'react';

// Surfaces "a new version is ready" without ever reloading mid-workout on its own. The service
// worker (registered in main.jsx with `registerType: 'prompt'`) dispatches a `pwa:needrefresh`
// window event and stashes its update function on `window.__pwaUpdateSW` when a new build has been
// fetched and is waiting. We show a dismissible prompt; the user chooses when to reload, so an
// active set is never interrupted. Using a window event (not the plugin's React virtual module)
// keeps this component free of build-only imports, so it renders and tests like any other.
export default function ServiceWorkerUpdater() {
  const [needRefresh, setNeedRefresh] = useState(false);

  useEffect(() => {
    const onNeedRefresh = () => setNeedRefresh(true);
    window.addEventListener('pwa:needrefresh', onNeedRefresh);
    return () => window.removeEventListener('pwa:needrefresh', onNeedRefresh);
  }, []);

  if (!needRefresh) return null;

  return (
    <div
      role="dialog"
      aria-label="Update available"
      style={{
        position: 'fixed',
        left: 16,
        right: 16,
        bottom: 16,
        margin: '0 auto',
        maxWidth: 420,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 16px',
        borderRadius: 12,
        background: 'var(--color-card-bg, #fff)',
        color: 'var(--color-text)',
        boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
        border: '1px solid var(--color-faint)',
        zIndex: 1000,
      }}
    >
      <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>A new version is available.</span>
      <button
        type="button"
        onClick={() => window.__pwaUpdateSW?.(true)}
        style={{
          padding: '6px 14px',
          borderRadius: 999,
          border: 'none',
          background: 'var(--color-accent, #d4673e)',
          color: '#fff',
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        Reload
      </button>
      <button
        type="button"
        onClick={() => setNeedRefresh(false)}
        style={{
          padding: '6px 10px',
          borderRadius: 999,
          border: '1px solid var(--color-faint)',
          background: 'transparent',
          color: 'var(--color-muted)',
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        Later
      </button>
    </div>
  );
}
