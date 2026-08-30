import { useState } from 'react';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useOfflinePin } from '../../hooks/useOfflinePin';
import { useOutboxCount } from '../../hooks/useOutboxCount';
import { useOutboxItems } from '../../hooks/useOutboxItems';
import { unpinOffline } from '../../lib/offlineMode';
import { probeReachability } from '../../lib/reachabilityProbe';
import Button from './Button';
import OutboxModal from './OutboxModal';

// The top-level offline signal, so the user is never in doubt about which mode they're in. While
// offline it names exactly how many entered changes are safely queued ("N changes waiting to
// sync") -- the reassurance that nothing is lost. While online it stays out of the way, except to
// briefly announce writes still draining after a reconnect. Renders nothing when online with an
// empty outbox.
export default function OfflineBanner() {
  const online = useOnlineStatus();
  const pinned = useOfflinePin();
  const queued = useOutboxCount();
  const [showOutbox, setShowOutbox] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);

  if (online && queued === 0) return null;

  const queuedLabel = queued === 1 ? '1 change waiting to sync' : `${queued} changes waiting to sync`;

  // Only leaves offline mode once the server actually answers -- never on a hopeful guess. Every
  // queued write is durable regardless of mode (see outboxPersistence.js), so there is no adverse
  // effect even if the probe passes but the connection is still genuinely bad: nothing is lost,
  // nothing errors destructively, and the write just keeps retrying/visible until it truly syncs.
  // That's what makes it safe to NOT auto-fall-back into offline mode if things go wrong afterward.
  async function handleGoBackOnline() {
    setCheckFailed(false);
    const reachable = await probeReachability();
    if (reachable) unpinOffline();
    else setCheckFailed(true);
  }

  return (
    <>
      <div
        role="status"
        aria-live="polite"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          padding: '8px 16px',
          background: 'var(--color-subtle-bg)',
          color: 'var(--color-muted)',
          fontSize: 13,
          fontWeight: 700,
          borderBottom: '1px solid var(--color-faint)',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: 'var(--color-muted)',
          }}
        />
        {online && <span>Syncing&hellip; </span>}
        {!online && queued > 0 && <span>Offline: </span>}
        {!online && queued === 0 && (
          <span>Offline. Your changes are saved on this device and will sync when you reconnect.</span>
        )}
        {queued > 0 && (
          <button
            onClick={() => setShowOutbox(true)}
            aria-haspopup="dialog"
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              color: 'inherit',
              font: 'inherit',
              fontWeight: 700,
              textDecoration: 'underline',
              cursor: 'pointer',
            }}
          >
            {queuedLabel}
          </button>
        )}
        {!online && queued > 0 && <span>. They&rsquo;ll sync when you reconnect.</span>}
        {pinned && (
          <Button
            onClick={handleGoBackOnline}
            style={{
              background: 'none',
              border: '1px solid var(--color-faint)',
              borderRadius: 999,
              padding: '3px 10px',
              color: 'inherit',
              font: 'inherit',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Go back online
          </Button>
        )}
        {pinned && checkFailed && (
          <span>Still can&rsquo;t reach the server: staying offline.</span>
        )}
      </div>
      {showOutbox && <OutboxModalContainer onClose={() => setShowOutbox(false)} />}
    </>
  );
}

// Split out so useOutboxItems (which needs AuthContext + the exercise catalog to resolve
// names) only mounts -- and only runs -- once the user actually opens the detail view, not on
// every render of the banner itself.
function OutboxModalContainer({ onClose }) {
  const items = useOutboxItems();
  return <OutboxModal items={items} onClose={onClose} />;
}
