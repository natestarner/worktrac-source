import { useOnlineStatus } from '../../hooks/useOnlineStatus';

// A persistent, always-visible banner while the device is offline, so the user is never in doubt
// about which mode they're in. The reassuring copy is deliberate: the whole point of offline mode
// is that entered data is safe and will sync, so the banner says exactly that. It renders nothing
// while online. A per-write "waiting to sync" indicator and the outbox count land with the durable
// outbox (PR 2); this banner is the top-level state signal.
export default function OfflineBanner() {
  const online = useOnlineStatus();
  if (online) return null;
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
      Offline — your changes are saved on this device and will sync when you reconnect.
    </div>
  );
}
