import { useOnlineStatus } from '../../hooks/useOnlineStatus';

// The inline "needs a connection" line shown beneath a disabled control while offline --
// mirrors the pattern PastSessionModal established. Renders nothing online.
export default function OfflineNotice({ message = 'This needs a connection.' }) {
  const online = useOnlineStatus();
  if (online) return null;
  return (
    <div style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 12 }}>{message}</div>
  );
}
