import { useQueryClient } from '@tanstack/react-query';
import { useUI } from '../../context/UIContext';
import { listSessionSets, deleteSet } from '../../api/sets';
import { queryKeys } from '../../api/queryKeys';
import { cancelPendingLogSet } from '../../lib/offlineSetEdits';
import Skeleton from '../shared/Skeleton';
import OfflineDisabledWrap from '../shared/OfflineDisabledWrap';

export default function SessionSummary({ entries, loading, sessionId, onSelectExercise, onChanged }) {
  const { openConfirm } = useUI();
  const queryClient = useQueryClient();

  async function handleRemove(entry) {
    // Not-yet-synced sets in this entry (see useSessionEntries.js) have no server row -- cancel
    // their pending creates outright instead of trying to delete something that doesn't exist yet.
    const optimisticIds = entry.sets.filter((s) => s.optimistic).map((s) => s.id);
    optimisticIds.forEach((tempId) => {
      cancelPendingLogSet(queryClient, tempId);
      if (sessionId) {
        queryClient.setQueryData(queryKeys.sessionSets(sessionId, entry.exerciseId), (old = []) =>
          old.filter((s) => s.id !== tempId),
        );
      }
    });

    // Already-synced sets in this entry still go through this direct (online-only) removal --
    // pre-existing behavior, unchanged here; making it durable/offline-safe is a separate gap
    // from the one this fixes (a not-yet-synced entry being removable at all).
    if (optimisticIds.length < entry.sets.length) {
      const sets = await listSessionSets(sessionId, entry.exerciseId);
      await Promise.all(sets.map((s) => deleteSet(s.id)));
    }
    onChanged();
  }

  if (loading) {
    return (
      <div style={{ marginBottom: 16 }}>
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: '4px 20px' }}>
          <div style={{ padding: '14px 0', borderBottom: '1px solid var(--color-subtle-bg)' }}>
            <Skeleton width={120} height={15} style={{ marginBottom: 4 }} />
            <Skeleton width={190} height={14} />
          </div>
          <div style={{ padding: '14px 0' }}>
            <Skeleton width={100} height={15} style={{ marginBottom: 4 }} />
            <Skeleton width={160} height={14} />
          </div>
        </div>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div style={{ marginBottom: 16, padding: '16px 20px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16, color: 'var(--color-muted)', fontSize: 14 }}>
        No exercises logged yet &mdash; add one below.
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 10 }}>
        Session exercises
      </div>
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: '0 20px' }}>
        {entries.map((entry, i) => (
          <div
            key={entry.exerciseId}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '14px 0',
              borderBottom: i < entries.length - 1 ? '1px solid var(--color-subtle-bg)' : 'none',
            }}
          >
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4, color: 'var(--color-text)' }}>{entry.exerciseName}</div>
              <div style={{ fontSize: 14, color: 'var(--color-muted)' }}>
                {entry.sets.map((s) => `${s.weight}${s.unit || 'lb'}×${s.reps}`).join('   ')}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 14, flexShrink: 0 }}>
              <button onClick={() => onSelectExercise(entry.exerciseId)} style={editLinkStyle}>
                Edit
              </button>
              {/* Removing an entry that has any already-synced set still needs a connection (see
                  handleRemove's direct listSessionSets+deleteSet branch above) -- an entry that's
                  only offline-logged so far can still be removed offline (cancels the pending
                  create locally, no network call). */}
              <OfflineDisabledWrap
                message="Removing this needs a connection."
                when={entry.sets.some((s) => !s.optimistic)}
              >
                <button onClick={() => openConfirm(`Remove ${entry.exerciseName} from this session?`, () => handleRemove(entry))} style={removeLinkStyle}>
                  Remove
                </button>
              </OfflineDisabledWrap>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const editLinkStyle = { background: 'none', border: 'none', color: 'var(--color-accent)', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const removeLinkStyle = { background: 'none', border: 'none', color: 'var(--color-danger)', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
