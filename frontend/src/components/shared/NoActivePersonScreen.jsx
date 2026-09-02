import { useState } from 'react';
import AppShellSkeleton from './AppShellSkeleton';
import AddPersonModal from './AddPersonModal';

// What AppShell renders instead of `null` when there is no active person.
//
// `return null` there was a genuinely empty #root, and an empty #root is not a quiet edge case in
// this app -- it is indistinguishable from a crashed boot, and boot-watchdog.js says so out loud:
// seven seconds of it and the person is looking at "Huddle couldn't load". Reproduced end to end
// on 2026-09-02 (see docs/incidents/2026-09-02-cold-backend-login-strands-the-device.md): #root
// emptied at 0.15s and the watchdog fired at 7s, with nothing wrong except that no person was
// selected. .claude/rules/resilience.md's contract is explicit that a failure degrades to "show
// what's cached", never to blank.
//
// Two genuinely different situations, and conflating them is what made the old `null` defensible:
//
//   people.length > 0 -- transient, normally a single commit. AppShell's own auto-select effect
//     picks the primary person immediately afterwards. AppShellSkeleton is deliberately the answer
//     here rather than anything new: ProtectedRoute was showing exactly this a frame earlier, so
//     the handover is pixel-identical and nothing flashes.
//
//   people.length === 0 -- NOT transient. Nothing will ever select a person, so this state stands
//     until something else changes it, which is precisely how a one-frame gap became a permanent
//     white screen. It also latches: RECONCILE_PEOPLE nulls activePersonId and empties byPerson
//     the first time the people list is empty, and appStatePersistence writes that SYNCHRONOUSLY,
//     so every later boot starts here too. This branch is the exit -- it explains the state and
//     offers the one action that resolves it.
export default function NoActivePersonScreen({ people }) {
  const [showAddPerson, setShowAddPerson] = useState(false);

  if (people.length > 0) {
    return <AppShellSkeleton />;
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-4)',
        background: 'var(--color-bg)',
      }}
    >
      <div
        role="alert"
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-6) var(--space-5)',
          maxWidth: 420,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', marginBottom: 'var(--space-2)' }}>
          No one to log for yet
        </div>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)', marginBottom: 'var(--space-5)' }}>
          This household has no people set up on this device. Add someone to start logging &mdash;
          anything you&rsquo;ve already logged is still saved and will sync.
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button type="button" onClick={() => setShowAddPerson(true)} className="btn btn-primary btn-lg pressable">
            Add a person
          </button>
          {/* A real navigation, not a client-side one -- the same reasoning as
              CriticalErrorFallback's: signing back in re-reads the people list from the server,
              which is the other thing that resolves this state. */}
          <a href="/login" className="btn btn-secondary btn-lg pressable">
            Go to login
          </a>
        </div>
      </div>
      {showAddPerson && <AddPersonModal onClose={() => setShowAddPerson(false)} />}
    </div>
  );
}
