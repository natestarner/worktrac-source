import { useQueryClient } from '@tanstack/react-query';
import SectionLabel from '../shared/SectionLabel';
import { useUI } from '../../context/UIContext';
import { listSessionSets } from '../../api/sets';
import { queryKeys } from '../../api/queryKeys';
import { cancelPendingLogSet } from '../../lib/offlineSetEdits';
import { dispatchDurableWrite, DELETE_SET_MUTATION_KEY } from '../../lib/queryClient';
import Skeleton from '../shared/Skeleton';
import OfflineDisabledWrap from '../shared/OfflineDisabledWrap';
import SetPillRow from '../shared/SetPillRow';

export default function SessionSummary({ entries, loading, sessionId, personId, onSelectExercise, onChanged }) {
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

    // Already-synced sets go through the SAME durable DELETE_SET write every other delete in the
    // app uses (the set row's own Delete button, EditSetModal), instead of calling the api layer
    // directly. This was the last write bypassing the outbox: it meant removing an exercise from
    // the session summary was the one delete that could not survive a connection drop, and the one
    // whose replay-404 was not already treated as success. The OfflineDisabledWrap around the
    // entry point stays for now -- see the register in .claude/rules/resilience.md -- because the
    // listSessionSets read this needs to enumerate the rows is itself an online-only fetch.
    if (optimisticIds.length < entry.sets.length) {
      const sets = await listSessionSets(sessionId, entry.exerciseId);
      sets.forEach((s) =>
        dispatchDurableWrite(queryClient, DELETE_SET_MUTATION_KEY, {
          setId: s.id,
          personId,
          exerciseId: entry.exerciseId,
          sessionId,
        }),
      );
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

  // Deliberately NOT the EmptyState primitive, unlike the screen-level empties on History, PRs and
  // Routines. This card sits directly above the exercise picker during a live workout, and
  // EmptyState's --space-10 padding plus a 32px icon would push the picker down out from under the
  // thumb at the one moment someone is reaching for it. Same reasoning as SessionBar reserving its
  // own space: mid-set, vertical room is the scarce resource.
  if (entries.length === 0) {
    return (
      <div style={{ marginBottom: 16, padding: '16px 20px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16, color: 'var(--color-muted)', fontSize: 14 }}>
        Nothing logged in this workout yet — pick an exercise below to start.
      </div>
    );
  }

  return (
    // Named class (like .log-sets-col / .person-pill-bar elsewhere) purely so tests can scope to
    // this list -- an exercise name legitimately appears here AND in the picker below AND in
    // search results, so a bare getByText for it is a strict-mode violation waiting to happen.
    <div className="session-exercises" style={{ marginBottom: 16 }}>
      <SectionLabel>
        Session exercises
      </SectionLabel>
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
              <SetPillRow sets={entry.sets} />
            </div>
            <div style={{ display: 'flex', gap: 14, flexShrink: 0 }}>
              <button onClick={() => onSelectExercise(entry.exerciseId)} style={editLinkStyle}>
                Edit
              </button>
              {/* Removing an entry with any already-synced set still needs a connection: the deletes
                  themselves are durable now, but enumerating which rows to delete needs a live
                  listSessionSets read. An entry that is only offline-logged so far can still be
                  removed offline -- that path just cancels the pending creates locally. */}
              <OfflineDisabledWrap
                message="Removing this needs a connection."
                when={entry.sets.some((s) => !s.optimistic)}
              >
                <button onClick={() => openConfirm(
                      `Remove ${entry.exerciseName}? The ${entry.sets.length} set${entry.sets.length === 1 ? '' : 's'} you logged for it in this workout will be deleted.`,
                      () => handleRemove(entry),
                    )} style={removeLinkStyle}>
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

const editLinkStyle = { background: 'none', border: 'none', color: 'var(--color-accent-text)', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const removeLinkStyle = { background: 'none', border: 'none', color: 'var(--color-danger)', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
