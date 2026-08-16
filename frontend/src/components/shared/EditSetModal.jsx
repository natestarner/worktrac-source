import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { dispatchDurableWrite, EDIT_SET_MUTATION_KEY } from '../../lib/queryClient';
import { patchPendingLogSetDisplay } from '../../lib/offlineSetEdits';
import { queryKeys } from '../../api/queryKeys';
import { formatRestTime, MIN_HOLD_SECONDS } from '../../utils/datetime';
import WeightRepsStepper from '../log/WeightRepsStepper';
import DurationWheel from './DurationWheel';
import Modal from './Modal';
import { cancelButtonStyle } from './ConfirmDialog';
import Button from './Button';

// exerciseId/sessionId are always taken from the caller's own context (ExerciseDetail already
// knows both) rather than read off `set` -- a synced set carries them too, but an offline-logged,
// not-yet-synced optimistic row never does, so this is the one code path that works for both.
export default function EditSetModal({ set, personId, exerciseId, exerciseName, sessionId, onClose, onSaved }) {
  // Via context (not the app singleton) so this finds/patches whichever client actually dispatched
  // the pending logSet mutation being edited -- the same client ExerciseDetail's useMutation used.
  const queryClient = useQueryClient();
  const [weight, setWeight] = useState(set.weight);
  const [reps, setReps] = useState(set.reps);
  // A hold is edited in seconds. Read off the SET, not the exercise: the set already records which
  // measure it was logged with, and it is the thing being corrected.
  const isDuration = set.durationSeconds != null;
  const [durationSeconds, setDurationSeconds] = useState(set.durationSeconds ?? 0);
  const [showWheel, setShowWheel] = useState(false);
  const step = set.unit === 'kg' ? 2.5 : 5;
  const DURATION_STEP = 5;
  // Exactly one measure, matching how the set was logged -- same rule as handleLogSet.
  const measure = isDuration ? { reps: 0, durationSeconds } : { reps, durationSeconds: null };
  // Save refuses a sub-minimum hold rather than quietly rounding it up. EditSetRequest declares
  // @Min(1) too, and this write is just as durable -- and so just as permanently discarded by a
  // 4xx -- as the original. Silently correcting a number you just chose is worse than refusing it,
  // because nothing on screen said 0:00 was out. BOTH duration controls here can reach 0:00 -- the
  // inline wheel by scrolling, the - button by stepping off the bottom -- so this is the single
  // floor they share, and it is deliberately the only one: neither control clamps on its own.
  const tooShort = isDuration && durationSeconds < MIN_HOLD_SECONDS;

  function handleSave() {
    // Show the new values immediately (offline included, where the write settles only on
    // reconnect). Skipped when there's no session yet -- the very first set(s) of an offline
    // workout live only as mutation state, not in this cache (see pendingBeforeSession).
    if (sessionId) {
      queryClient.setQueryData(queryKeys.sessionSets(sessionId, exerciseId), (old = []) =>
        old.map((s) => (s.id === set.id ? { ...s, weight, ...measure } : s)),
      );
    }
    if (set.optimistic) {
      // Not yet synced -- the queued CREATE is deliberately left untouched (see offlineSetEdits.js
      // for why: no public API to edit or cancel an in-flight mutation, and re-dispatching it under
      // the same idempotency key risks the backend silently discarding the edit). Only the
      // pre-session display needs a direct patch; once a session exists the setQueryData above
      // already covers it.
      patchPendingLogSetDisplay(queryClient, set.id, { weight, ...measure });
    }
    // Always a real, separate EDIT_SET write -- set.id is the tempId for an optimistic row
    // (resolved once its create syncs, see queryClient.js's requireResolvedSetId/setSetIdMapping)
    // or a real id for an already-synced one. Editing a pending set now behaves identically to
    // editing a synced set in every connectivity mode. Dispatched against the same context
    // `queryClient` used above (not the app-singleton-only enqueueOutboxWrite) so it lands in the
    // exact mutation cache holding the matching pending create.
    dispatchDurableWrite(queryClient, EDIT_SET_MUTATION_KEY, { setId: set.id, weight, ...measure, personId, sessionId, exerciseId, exerciseName });
    onSaved();
  }

  return (
    <Modal width={320} onClose={onClose} title="Edit set">
      <WeightRepsStepper
        label={`Weight (${set.unit || 'lb'})`}
        value={weight}
        size="sm"
        onDec={() => setWeight(Math.max(0, Math.round((weight - step) * 2) / 2))}
        onInc={() => setWeight(Math.round((weight + step) * 2) / 2)}
        onChange={setWeight}
      />
      {isDuration ? (
        <>
          {/* Stepping off the bottom goes to 0:00 rather than parking on 0:01 -- the same rule the
              log screen's - button follows. A minimum left sitting in the field reads as a
              deliberate one-second hold, and it gives the last press of - nothing to do.

              What 0:00 MEANS still differs between the two screens, and that difference is the
              real exception here, not the clamp: on the log screen it is "no duration chosen",
              renders as an em dash, and Log set carries on with the default. An already-logged set
              has no such blank to fall back to, so here 0:00 is simply not a saveable set and
              `tooShort` disables Save. That is not a new dead end -- this modal's own inline wheel
              could already be scrolled to 0:00, and the - button reaching the same value is what
              makes the two agree. Recovering is one press of + or one pick on the wheel. */}
          <WeightRepsStepper
            label="Time"
            value={durationSeconds}
            displayValue={formatRestTime(durationSeconds)}
            size="sm"
            onPick={() => setShowWheel((open) => !open)}
            onDec={() => setDurationSeconds(Math.max(0, durationSeconds - DURATION_STEP))}
            onInc={() => setDurationSeconds(durationSeconds + DURATION_STEP)}
          />
          {/* Inline, not the bottom sheet the log screen opens. A sheet here would be a modal over
              a modal: two scrims, two focus traps, and an Escape whose target you have to guess.
              Same wheel, revealed in place under the value it belongs to -- which is also why the
              value acts as a toggle rather than a one-way open.

              It writes straight to local state with no Done of its own, because this modal already
              has the pair: Cancel discards every edit in it, Save commits them. That is the same
              draft-until-committed shape DurationPickerSheet gives the log screen, so the floor
              lands in the same place -- on `measure` below, not on the wheel. */}
          {showWheel && (
            <DurationWheel className="duration-wheel-inline" valueSeconds={durationSeconds} onChange={setDurationSeconds} />
          )}
        </>
      ) : (
        <WeightRepsStepper
          label="Reps"
          value={reps}
          size="sm"
          onDec={() => setReps(Math.max(0, reps - 1))}
          onInc={() => setReps(reps + 1)}
          onChange={setReps}
        />
      )}
      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        <button onClick={onClose} style={cancelButtonStyle}>
          Cancel
        </button>
        <Button
          onClick={handleSave}
          disabled={tooShort}
          style={{ flex: 1, padding: 14, background: 'var(--color-accent)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}
        >
          Save
        </Button>
      </div>
    </Modal>
  );
}
