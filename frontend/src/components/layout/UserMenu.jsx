import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { queryClient } from '../../lib/queryClient';
import { getQueuedWriteCount } from '../../hooks/useOutboxCount';

// `booting` is passed by AppShellSkeleton only. That skeleton renders a REAL Header so the
// boot paint matches the loaded one pixel-for-pixel -- but the tree it renders is guaranteed to
// be thrown away: ProtectedRoute swaps AppShellSkeleton for AppShell the moment auth resolves and
// the persisted state rehydrates, which unmounts this component and takes `open` with it.
//
// So a menu opened during boot closes itself, silently, with no indication the tap was discarded.
// Reload on a slow connection, tap your name, and the menu appears and then vanishes a beat later
// -- a full 2.7s window was measured under load. Disabling the trigger while booting turns that
// silently-dropped interaction into a well-defined wait: the control is visibly there (so the
// layout doesn't shift) and simply isn't armed until the app it belongs to is.
//
// It also makes the same race impossible for anything DRIVING the app rather than watching it:
// Playwright's actionability check waits for a disabled button, so a click issued mid-boot now
// lands after the real Header mounts instead of opening a menu that is about to disappear.
// See docs/incidents/2026-08-13-e2e-parallel-flakiness.md.
export default function UserMenu({ booting = false }) {
  const { people, logout, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pendingLogoutCount, setPendingLogoutCount] = useState(0);
  const containerRef = useRef(null);

  const primaryName = people.find((p) => p.isPrimary)?.name || 'Account';

  // No existing dropdown/click-outside primitive in the codebase (Modal.jsx is a
  // full-screen scrim, not an anchored menu) -- close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
        setPendingLogoutCount(0);
      }
    }
    function handleKey(e) {
      if (e.key === 'Escape') {
        setOpen(false);
        setPendingLogoutCount(0);
      }
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  function go(path) {
    setOpen(false);
    navigate(path);
  }

  function handleLogout() {
    // Guard against silently discarding queued offline writes: logging out clears this device's
    // outbox (a different household may log in next), so confirm inline if anything hasn't synced
    // yet (hardening #4 -- a forced 401 logout, by contrast, preserves the outbox to replay after
    // re-login; only this explicit user action discards). Reading the count off the app's singleton
    // client keeps this a pure local-state confirm, with no extra context dependency in the header.
    const queued = getQueuedWriteCount(queryClient);
    if (queued > 0) {
      setPendingLogoutCount(queued);
    } else {
      setOpen(false);
      logout();
    }
  }

  function confirmLogout() {
    setPendingLogoutCount(0);
    setOpen(false);
    logout();
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={booting}
        aria-expanded={open}
        aria-haspopup="menu"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'none',
          border: 'none',
          color: 'var(--color-muted)',
          fontSize: 14,
          fontWeight: 600,
          cursor: 'pointer',
          padding: 8,
        }}
      >
        {primaryName}
        <span style={{ fontSize: 10, transform: open ? 'rotate(180deg)' : 'none' }}>&#9662;</span>
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.16)',
            minWidth: 180,
            overflow: 'hidden',
            // Must beat --z-app-chrome: this panel hangs below the header, which is no longer
            // inside the sticky chrome, so it is the chrome it overlaps rather than the chrome's
            // own children. At an equal z-index the later-in-DOM chrome wins and eats the clicks.
            zIndex: 'var(--z-header-menu)',
          }}
        >
          <MenuItem label="Profile" onClick={() => go('/app/profile')} />
          <MenuItem label="App Settings" onClick={() => go('/app/settings')} />
          {isAdmin && (
            <>
              <div style={{ borderTop: '1px solid var(--color-border)' }} />
              <MenuItem label="Admin Portal" onClick={() => go('/admin')} />
            </>
          )}
          <div style={{ borderTop: '1px solid var(--color-border)' }} />
          {pendingLogoutCount > 0 ? (
            <div role="alertdialog" aria-label="Unsynced changes" style={{ padding: '12px 16px' }}>
              <div style={{ fontSize: 13, color: 'var(--color-text)', marginBottom: 10 }}>
                {pendingLogoutCount === 1 ? '1 change hasn’t' : `${pendingLogoutCount} changes haven’t`} synced yet
                and will be lost if you log out.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button role="menuitem" onClick={confirmLogout} style={dangerButtonStyle}>
                  Log out anyway
                </button>
                <button onClick={() => setPendingLogoutCount(0)} style={cancelInlineStyle}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <MenuItem label="Logout" onClick={handleLogout} />
          )}
        </div>
      )}
    </div>
  );
}

const dangerButtonStyle = {
  flex: 1,
  padding: '8px 10px',
  background: 'var(--color-danger)',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
};

const cancelInlineStyle = {
  padding: '8px 10px',
  background: 'none',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--color-muted)',
  cursor: 'pointer',
};

function MenuItem({ label, onClick }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        background: 'none',
        border: 'none',
        padding: '12px 16px',
        fontSize: 14,
        fontWeight: 600,
        color: 'var(--color-text)',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}
