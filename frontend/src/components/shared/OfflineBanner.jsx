import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useOutboxCount } from '../../hooks/useOutboxCount';

// The top-level offline signal, so the user is never in doubt about which mode they're in. While
// offline it names exactly how many entered changes are safely queued ("N changes waiting to
// sync") -- the reassurance that nothing is lost. While online it stays out of the way, except to
// briefly announce writes still draining after a reconnect. Renders nothing when online with an
// empty outbox.
export default function OfflineBanner() {
  const online = useOnlineStatus();
  const queued = useOutboxCount();

  if (online && queued === 0) return null;

  const queuedLabel = queued === 1 ? '1 change waiting to sync' : `${queued} changes waiting to sync`;

  const message = online
    ? `Syncing… ${queuedLabel}`
    : queued > 0
      ? `Offline — ${queuedLabel}. They'll sync when you reconnect.`
      : 'Offline — your changes are saved on this device and will sync when you reconnect.';

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
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
      {message}
    </div>
  );
}
