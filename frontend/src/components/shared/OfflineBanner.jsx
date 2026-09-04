import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useOfflinePin } from '../../hooks/useOfflinePin';
import { useOutboxCount, getUnsyncedWriteCount } from '../../hooks/useOutboxCount';
import { useOutboxItems, discardOutboxItem } from '../../hooks/useOutboxItems';
import { useJustSynced } from '../../hooks/useJustSynced';
import { useUI } from '../../context/UIContext';
import { unpinOffline } from '../../lib/offlineMode';
import { clearOutboxMutations } from '../../lib/queryClient';
import { clearOutbox } from '../../lib/outboxPersistence';
import { probeReachability } from '../../lib/reachabilityProbe';
import Button from './Button';
import OutboxModal from './OutboxModal';
import { IconCheck } from './icons';

// The top-level offline signal, so the user is never in doubt about which mode they're in. While
// offline it names exactly how many entered changes are safely queued ("N changes waiting to
// sync") -- the reassurance that nothing is lost. While online it stays out of the way, except to
// briefly announce writes still draining after a reconnect, and then to confirm once they have
// landed. Renders nothing when online with an empty outbox and nothing recently drained.
//
// That last beat is the point of `useJustSynced`: this banner used to communicate success purely
// by ABSENCE -- it counted "3 changes waiting to sync" and then silently unmounted, so the single
// moment the app keeps its central promise was the one moment it said nothing.
export default function OfflineBanner() {
  const online = useOnlineStatus();
  const pinned = useOfflinePin();
  const queued = useOutboxCount();
  const justSynced = useJustSynced(online, queued);
  const [showOutbox, setShowOutbox] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);

  if (online && queued === 0 && !justSynced) return null;

  // Every other state in this banner is an ongoing condition; this one is a completed event, so it
  // takes the check rather than the pulseless status dot.
  const caughtUp = online && queued === 0;

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
        {caughtUp ? (
          <IconCheck size={14} />
        ) : (
          <span
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--color-muted)',
            }}
          />
        )}
        {caughtUp && <span>All caught up.</span>}
        {online && queued > 0 && <span>Syncing&hellip; </span>}
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
//
// It also owns the two destructive actions, keeping OutboxModal itself presentational. Both close
// this modal before opening the confirm, matching ExerciseDetail's handleRequestDelete: ConfirmDialog
// is itself a Modal, and Modal installs a focus trap, so stacking two is a trap over a trap with no
// coherent answer for what Escape closes.
function OutboxModalContainer({ onClose }) {
  const queryClient = useQueryClient();
  const { openConfirm } = useUI();
  const items = useOutboxItems();

  function handleDiscard(item) {
    onClose();
    openConfirm(
      `Discard this change? ${item.personName}${item.exerciseName ? ` — ${item.exerciseName}` : ''}: ${item.detail}. It won't be sent, and it can't be recovered.`,
      () => discardOutboxItem(queryClient, item.id),
    );
  }

  function handleClearAll() {
    onClose();
    // getUnsyncedWriteCount, NOT the banner's display count -- the same choice UserMenu's logout
    // guard makes, and for the same reason: this discards the outbox, so a write still on the wire
    // (which the display predicate deliberately hides so a fast online write can't flash the
    // banner) is exactly one this action strips of its retry. See useOutboxCount.js.
    const atRisk = getUnsyncedWriteCount(queryClient);
    // Zero at risk with a non-empty list is a real state, not an edge case: it means everything
    // showing is already undeliverable (a definitive rejection, or a dependency that is gone), so
    // "discard 0 changes" would be both wrong and alarming. Say what is actually true instead.
    const message =
      atRisk === 0
        ? "Clear the sync list? Nothing in it is still waiting to reach the server, so this only removes changes that can't be sent."
        : `Discard ${atRisk === 1 ? '1 change' : `${atRisk} changes`} that ${atRisk === 1 ? "hasn't" : "haven't"} synced yet? They won't be sent, and they can't be recovered.`;
    openConfirm(
      message,
      () => {
        // The same pair AuthContext.logout() uses: the live mutation cache AND the persisted
        // IndexedDB copy. Clearing only the first lets the next reload restore everything.
        clearOutboxMutations(queryClient);
        return clearOutbox();
      },
    );
  }

  return <OutboxModal items={items} onDiscard={handleDiscard} onClearAll={handleClearAll} onClose={onClose} />;
}
