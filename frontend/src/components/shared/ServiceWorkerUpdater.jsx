import { useState, useSyncExternalStore } from 'react';
import { applyUpdate, isUpdateAvailable, subscribeUpdateAvailable } from '../../lib/swUpdate';

// Fallback surface for "a new version is ready" -- AppShell/LogTab's forced-reload triggers
// (person/section/exercise switch, ending a workout, tab visibility regained) apply a pending
// update automatically at the next safe pause point, so most users never see this. It only matters
// for someone who parks on one screen for a long session without navigating anywhere. Never
// reloads on its own even then -- the user chooses when, so an active set is never interrupted.
export default function ServiceWorkerUpdater() {
  const available = useSyncExternalStore(subscribeUpdateAvailable, isUpdateAvailable, () => false);
  // Local to this component, deliberately separate from the shared `available` flag -- dismissing
  // only hides THIS banner. It must NOT clear `available`, or a forced-reload trigger firing a
  // moment later (switching person/section/exercise, ending a workout) would have nothing to apply.
  const [dismissed, setDismissed] = useState(false);

  if (!available || dismissed) return null;

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
        onClick={() => applyUpdate()}
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
        onClick={() => setDismissed(true)}
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
