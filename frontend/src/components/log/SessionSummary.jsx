import { useQueryClient } from '@tanstack/react-query';
import SectionLabel from '../shared/SectionLabel';
import { useUI } from '../../context/UIContext';
import { listSessionSets } from '../../api/sets';
import { queryKeys } from '../../api/queryKeys';
import { deleteQueuedSet } from '../../lib/offlineSetEdits';
import { dispatchDurableWrite, DELETE_SET_MUTATION_KEY } from '../../lib/queryClient';
import Skeleton from '../shared/Skeleton';
import OfflineDisabledWrap from '../shared/OfflineDisabledWrap';
import SetPillRow from '../shared/SetPillRow';
import PrBadge, { prBadgeLabel } from '../shared/PrBadge';
import IconButton from '../shared/IconButton';
import { liveSessionPrFlagKey } from '../../utils/historyPrFlags';
import Card from '../shared/Card';
import { IconPencil, IconTrash } from '../shared/icons';

// `prFlags` is the { setMarks, sessionMarks } pair from historyPrFlags.js#buildHistoryPrFlags,
// built by LogTab over `history` PLUS the live session. These rows are entry rows with the same
// shape as History's, so they get the same treatment: set-level records badge the individual set
// pill, and the session-level record badges the exercise NAME -- no single set is the answer to a
// session total. Omitting it renders plain rows, exactly as before.
// "Could the server hold rows for this entry that Remove has to enumerate and delete?"
//
// Not "does the row show a synced set" -- the row is built from `history`, which lags a set that has
// just synced by one refetch. In that window a synced set is in NEITHER source the row reads: its
// LOG_SET has succeeded, so it has left the pending list, and history has not caught up. Tapping
// Remove then saw an entry of only optimistic sets, skipped listSessionSets, and left the synced set
// on the server. A succeeded LOG_SET for this exercise INTO THIS SESSION is the local evidence of
// such a row; it lingers in the mutation cache well past history's refetch. Evaluated before any
// cancelling, and also what gates the offline wrap below, so the button is disabled offline exactly
// when Remove needs the network.
function mayHaveServerRows(queryClient, entry, { personId, sessionId }) {
  if (!sessionId) return false;
  if (entry.sets.some((s) => !s.optimistic)) return true;
  return queryClient
    .getMutationCache()
    .getAll()
    .some(
      (m) =>
        m.options.mutationKey?.[0] === 'logSet' &&
        m.state.status === 'success' &&
        m.state.variables?.personId === personId &&
        m.state.variables?.exerciseId === entry.exerciseId &&
        m.state.data?.session?.id === sessionId,
    );
}

export default function SessionSummary({ entries, prFlags, loading, sessionId, personId, onSelectExercise, onChanged }) {
  const { openConfirm } = useUI();
  const queryClient = useQueryClient();

  async function handleRemove(entry) {
    // Decided before anything below touches the mutation cache -- see mayHaveServerRows.
    const enumerateServerRows = mayHaveServerRows(queryClient, entry, { personId, sessionId });

    // Not-yet-confirmed sets in this entry (see useSessionEntries.js) go through deleteQueuedSet:
    // cancelled if the create never left the device, otherwise a real delete queued behind it. A
    // create tapped away mid-save is already on the wire, and cancelling that deleted nothing
    // (docs/incidents/2026-09-23-remove-mid-save-deleted-nothing.md).
    const optimisticIds = entry.sets.filter((s) => s.optimistic).map((s) => s.id);
    optimisticIds.forEach((tempId) => {
      deleteQueuedSet(queryClient, tempId, { personId, exerciseId: entry.exerciseId, sessionId });
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
    //
    // A row listed here that is ALSO still queued by tempId above just gets two deletes; the
    // second 404s, which DELETE_SET treats as done.
    if (enumerateServerRows) {
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
    // The exerciseId is reported upward so LogTab can re-arm its volume-celebration latch:
    // removing these sets lowers the exercise's all-time session-volume record, and a latch left
    // at the old value would suppress every genuine new record below it, permanently. Passed as an
    // argument rather than read from context here, so this component stays a leaf.
    onChanged(entry.exerciseId);
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
      <Card size="dense" style={{ marginBottom: 16, color: 'var(--color-muted)', fontSize: 14 }}>
        Nothing logged in this workout yet — pick an exercise below to start.
      </Card>
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
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 4 }}>
                {/* Leads the name, matching History's entry header -- glyph-only in its own pill
                    (`PrBadge`'s `pill` prop), not the wider icon+word badge this replaced.
                    flexShrink: 0 so a long name wraps around it instead of squeezing it. */}
                {(prFlags?.sessionMarks.get(liveSessionPrFlagKey(sessionId, entry.exerciseId)) || []).map((type) => (
                  <span key={type} style={{ flexShrink: 0 }} aria-label={`${prBadgeLabel([type])} for ${entry.exerciseName}`}>
                    <PrBadge type={type} size={12} pill />
                  </span>
                ))}
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text)', minWidth: 0, overflowWrap: 'anywhere' }}>
                  {entry.exerciseName}
                </div>
              </div>
              <SetPillRow sets={entry.sets} prMarks={prFlags?.setMarks.get(liveSessionPrFlagKey(sessionId, entry.exerciseId))} />
            </div>
            {/* Icon buttons, not text links -- same swap ExerciseDetail's set rows already made for
                the identical reason (see IconPencil/IconTrash there). Two text links cost the name
                ~90-110px on every row, long name or not; the labels stay exactly "Edit" and
                "Remove" as the accessible name, so every e2e assertion that selects these by name
                (`getByRole('button', { name: 'Edit' })` etc.) is unaffected. */}
            <div style={{ display: 'flex', gap: 'var(--space-1)', flexShrink: 0 }}>
              <IconButton onClick={() => onSelectExercise(entry.exerciseId)} label="Edit" icon={IconPencil} tone="accent" />
              {/* Removing an entry that may have server rows still needs a connection: the deletes
                  themselves are durable now, but enumerating which rows to delete needs a live
                  listSessionSets read (see mayHaveServerRows). An entry that is only offline-logged
                  so far can still be removed offline -- deleteQueuedSet handles each pending create. */}
              <OfflineDisabledWrap
                message="Removing this needs a connection."
                when={mayHaveServerRows(queryClient, entry, { personId, sessionId })}
              >
                <IconButton
                  onClick={() => openConfirm(
                      `Remove ${entry.exerciseName}? The ${entry.sets.length} set${entry.sets.length === 1 ? '' : 's'} you logged for it in this workout will be deleted.`,
                      () => handleRemove(entry),
                    )}
                  label="Remove"
                  icon={IconTrash}
                  tone="danger"
                />
              </OfflineDisabledWrap>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
