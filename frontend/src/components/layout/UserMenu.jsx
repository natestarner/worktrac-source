import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { queryClient } from '../../lib/queryClient';
import { getUnsyncedWriteCount } from '../../hooks/useOutboxCount';
import { TOUR_ANCHORS } from '../onboarding/tourSteps';

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
  const { people, logout, isAdmin, households, account, switchHousehold } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [pendingLogoutCount, setPendingLogoutCount] = useState(0);
  // The household a switch is waiting on, once the person has been told about unsynced work.
  const [pendingSwitch, setPendingSwitch] = useState(null);
  const [switching, setSwitching] = useState(false);
  const containerRef = useRef(null);

  // Only the OTHER households -- there is nothing to switch to when there is one, and offering the
  // one you are already in is a control that does nothing. Undefined on an older auth snapshot,
  // which reads as "nowhere to go" and hides the entry rather than erroring.
  const otherHouseholds = (households ?? []).filter(
    (h) => String(h.accountId) !== String(account?.id),
  );

  const primaryName = people.find((p) => p.isPrimary)?.name || 'Account';

  // No existing dropdown/click-outside primitive in the codebase (Modal.jsx is a
  // full-screen scrim, not an anchored menu) -- close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
        setPendingLogoutCount(0);
        setPendingSwitch(null);
      }
    }
    function handleKey(e) {
      if (e.key === 'Escape') {
        setOpen(false);
        setPendingLogoutCount(0);
        setPendingSwitch(null);
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
    // Carries where they were when they opened the menu. Only Contact Us reads it (to record which
    // screen a bug report came from), but passing it for every item keeps one code path -- and a
    // route that ignores `state` is unaffected by its presence.
    navigate(path, { state: { from: location.pathname } });
  }

  function handleLogout() {
    // Guard against silently discarding queued offline writes: logging out clears this device's
    // outbox (a different household may log in next), so confirm inline if anything hasn't synced
    // yet (hardening #4 -- a forced 401 logout, by contrast, preserves the outbox to replay after
    // re-login; only this explicit user action discards). Reading the count off the app's singleton
    // client keeps this a pure local-state confirm, with no extra context dependency in the header.
    //
    // getUnsyncedWriteCount, NOT the banner's getQueuedWriteCount: the banner deliberately ignores
    // a write that is in flight on its first attempt (so a fast online write doesn't flash it), and
    // a write on the wire is exactly one this action would strip of its retry. Asking the display
    // predicate here left the last write of a drain unguarded.
    const queued = getUnsyncedWriteCount(queryClient);
    if (queued > 0) {
      setPendingLogoutCount(queued);
    } else {
      setOpen(false);
      logout();
    }
  }

  // Switching household needs the network -- it mints a new session token, and there is no offline
  // equivalent of that. Rather than a connectivity branch, the attempt simply surfaces its own
  // failure like any other gated write would; useOnlineStatus is not consulted here.
  async function runSwitch(household) {
    setPendingSwitch(null);
    setSwitching(true);
    try {
      await switchHousehold(household.accountId);
      setOpen(false);
      navigate('/app/log');
    } catch {
      // Deliberately swallowed to a no-op UI-wise: nothing was torn down (establishSession only
      // commits after /me answers), so the person is still exactly where they were, in the
      // household they were already in. Reopening the menu and trying again is the whole recovery.
    } finally {
      setSwitching(false);
    }
  }

  function handleSwitch(household) {
    // getUnsyncedWriteCount, NOT the banner's display count -- same reasoning as handleLogout: the
    // banner deliberately ignores a brand-new in-flight write, and a decision about someone's data
    // needs the honest answer.
    const queued = getUnsyncedWriteCount(queryClient);
    if (queued > 0) {
      setPendingSwitch({ ...household, count: queued });
      return;
    }
    runSwitch(household);
  }

  function confirmSwitch() {
    runSwitch(pendingSwitch);
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
        data-tour-anchor={TOUR_ANCHORS.ACCOUNT_MENU}
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
          {/* "Plan & billing" -- checked against every other label on this screen for the
              substring rule below. It shares none, and crucially it is NOT "Upgrade to Pro":
              that string is the billing screen's own primary button, and a Free household
              standing on /app/billing would then have two controls with the same accessible
              name. The header badge is "Go Pro" for the same reason. */}
          <MenuItem label="Plan & billing" onClick={() => go('/app/billing')} />
          {/* Help sits directly above Contact Us so the menu reads as an escalation ladder:
              answer it yourself, then ask a human. Both labels deliberately share no substring
              with Profile / App Settings / Admin Portal / Logout / Log out anyway / Cancel --
              Playwright matches accessible names as a case-insensitive substring, so an
              overlapping label here breaks specs elsewhere on this screen. "Help" is also
              checked against the Trends "?" buttons, whose names are full sentences
              ("What the consistency grid shows") and contain no "help". */}
          <MenuItem label="Help" onClick={() => go('/app/help')} />
          <MenuItem label="Contact Us" onClick={() => go('/app/contact')} />
          {isAdmin && (
            <>
              <div style={{ borderTop: '1px solid var(--color-border)' }} />
              <MenuItem label="Admin Portal" onClick={() => go('/admin')} />
            </>
          )}
          {otherHouseholds.length > 0 && (
            <>
              <div style={{ borderTop: '1px solid var(--color-border)' }} />
              {/* "Switch to" rather than "Switch household": Playwright matches accessible names
                  as a case-insensitive SUBSTRING, and every label in this menu is deliberately
                  non-overlapping (see the Help/Contact Us comment above). Naming each household
                  also removes a step -- with two households the menu IS the picker. */}
              {otherHouseholds.map((household) => (
                <MenuItem
                  key={household.accountId}
                  label={`Switch to ${household.accountName}`}
                  disabled={switching}
                  onClick={() => handleSwitch(household)}
                />
              ))}
            </>
          )}
          <div style={{ borderTop: '1px solid var(--color-border)' }} />
          {pendingSwitch ? (
            <div role="alertdialog" aria-label="Unsynced changes" style={{ padding: '12px 16px' }}>
              {/* ⚠️ SUSPENSION, NOT DESTRUCTION -- and this is deliberately NOT logout's wording.
                  Logging out clears this device's outbox; switching household does not. The
                  outgoing household's queued writes stay on their own IndexedDB key (adoptOutboxScope
                  flips the scope pointer BEFORE evicting the mutation cache), so they are waiting,
                  not lost, and switching back restores and syncs them.

                  Reusing "will be lost" here would tell someone their work is about to be destroyed
                  when it is not, which is its own kind of bug -- it would push people into waiting
                  out a sync they never needed to wait for. Same getUnsyncedWriteCount source as
                  logout (the safety count, never the banner's display count), much lower severity. */}
              <div style={{ fontSize: 13, color: 'var(--color-text)', marginBottom: 10 }}>
                {pendingSwitch.count === 1 ? '1 change hasn’t' : `${pendingSwitch.count} changes haven’t`} synced yet.
                They’ll stay saved here and sync when you switch back.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button role="menuitem" onClick={confirmSwitch} style={cancelInlineStyle}>
                  Switch anyway
                </button>
                <button onClick={() => setPendingSwitch(null)} style={cancelInlineStyle}>
                  Stay here
                </button>
              </div>
            </div>
          ) : pendingLogoutCount > 0 ? (
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

function MenuItem({ label, onClick, disabled = false }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
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
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  );
}
