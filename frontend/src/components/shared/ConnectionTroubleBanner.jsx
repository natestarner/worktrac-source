import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useOfflinePin } from '../../hooks/useOfflinePin';
import { useConnectionTrouble } from '../../hooks/useConnectionTrouble';
import { pinOffline } from '../../lib/offlineMode';
import Button from './Button';

// The gap navigator.onLine can't see: gym wifi behind a captive portal, a dead upstream, or
// flaky cellular all report "online" while every request actually times out. api/client.js feeds
// every request's outcome to reachabilityMonitor; after a few consecutive failures with the
// browser still claiming to be online, this suggests the one fix automatic detection can't reach
// for -- switching to offline mode by hand, so writes queue safely instead of hanging. Hidden the
// instant the user acts (pinned) or a request actually succeeds (trouble clears).
export default function ConnectionTroubleBanner() {
  const online = useOnlineStatus();
  const pinned = useOfflinePin();
  const trouble = useConnectionTrouble();

  if (!trouble || !online || pinned) return null;

  return (
    <div role="status" aria-live="polite" style={bannerStyle}>
      <span
        aria-hidden="true"
        style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-warning-text)', flexShrink: 0 }}
      />
      <span>Having trouble connecting.</span>
      <Button onClick={() => pinOffline()} style={buttonStyle}>
        Go offline
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
  background: 'var(--color-warning-bg)',
  color: 'var(--color-warning-text)',
  fontSize: 13,
  fontWeight: 700,
  borderBottom: '1px solid var(--color-warning-border)',
};

const buttonStyle = {
  padding: '5px 12px',
  background: 'var(--color-warning-text)',
  color: 'var(--color-warning-bg)',
  border: 'none',
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
};
