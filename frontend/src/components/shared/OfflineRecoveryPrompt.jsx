import { unpinOffline } from '../../lib/offlineMode';
import { useOfflineRecoveryHeartbeat } from '../../hooks/useOfflineRecoveryHeartbeat';
import Button from './Button';

// Shown only while manually pinned offline (see offlineMode.js) once the recovery heartbeat has
// confirmed the server is reachable again. Deliberately a prompt, not an auto-resume -- a pin the
// user set on purpose should only ever be lifted by the user, so a connection that flickers back
// for a moment can't silently flip them back online mid-workout.
export default function OfflineRecoveryPrompt() {
  const reachable = useOfflineRecoveryHeartbeat();
  if (!reachable) return null;

  return (
    <div role="status" aria-live="polite" style={bannerStyle}>
      <span>Looks like you&rsquo;re back online.</span>
      <Button onClick={() => unpinOffline()} style={buttonStyle}>
        Resume syncing
      </Button>
    </div>
  );
}

const bannerStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  padding: '8px 16px',
  background: 'var(--color-success-bg)',
  color: 'var(--color-success)',
  fontSize: 13,
  fontWeight: 700,
  borderBottom: '1px solid var(--color-success)',
};

const buttonStyle = {
  padding: '5px 12px',
  background: 'var(--color-success)',
  color: '#fff',
  border: 'none',
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
};
