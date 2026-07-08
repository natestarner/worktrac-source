import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAppState } from '../../context/AppStateContext';
import { useUI } from '../../context/UIContext';
import { getExerciseSummary } from '../../api/stats';
import { listSessionSets, logLiveSet, logSetIntoSession, deleteSet } from '../../api/sets';
import { listSetupValues } from '../../api/setupValues';
import { computePrefillDraft, isPrSet, toLb } from '../../utils/formulas';
import { formatDateLabel, toLocalDateStr } from '../../utils/datetime';
import WeightRepsStepper from './WeightRepsStepper';
import NumericKeypad from '../shared/NumericKeypad';
import SetupFieldEditorModal from '../shared/SetupFieldEditorModal';
import EditSetModal from '../shared/EditSetModal';
import Button from '../shared/Button';

export default function ExerciseDetail({
  exercise,
  personId,
  editingSessionId,
  liveSession,
  refetchLiveSession,
  hasActiveRoutine,
  nextButtonLabel,
  onNextExercise,
  onBack,
}) {
  const { account } = useAuth();
  const { weightDraft, repsDraft, setWeightDraft, setRepsDraft } = useAppState();
  const { showCelebration, startRestTimer, openConfirm } = useUI();

  const contextSessionId = editingSessionId || liveSession?.id || null;

  const [summary, setSummary] = useState(null);
  const [sessionSets, setSessionSets] = useState([]);
  const [setupValues, setSetupValues] = useState([]);
  const [keypadField, setKeypadField] = useState(null);
  const [editingSetupField, setEditingSetupField] = useState(null);
  const [editingSet, setEditingSet] = useState(null);

  const defaultUnit = account?.defaultUnit || 'lb';

  function refetchSummary() {
    return getExerciseSummary(personId, exercise.id, contextSessionId || undefined).then(setSummary);
  }
  function refetchSessionSets() {
    if (!contextSessionId) {
      setSessionSets([]);
      return Promise.resolve();
    }
    return listSessionSets(contextSessionId, exercise.id).then(setSessionSets);
  }
  function refetchSetupValues() {
    return listSetupValues(personId, exercise.id).then(setSetupValues);
  }

  useEffect(() => {
    refetchSummary();
    refetchSessionSets();
    refetchSetupValues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercise.id, contextSessionId]);

  // Prefill weight/reps from the same set-index in the most recent prior session,
  // recomputed whenever the exercise, its summary, or how many sets are already logged
  // in this session changes -- matches the prototype's refreshDraft exactly.
  useEffect(() => {
    if (!summary) return;
    const draft = computePrefillDraft(summary.lastSession, sessionSets.length, defaultUnit);
    setWeightDraft(draft.weight);
    setRepsDraft(draft.reps);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary, sessionSets.length]);

  const weightStep = defaultUnit === 'kg' ? 2.5 : 5;

  function decWeight() {
    setWeightDraft(Math.max(0, Math.round((weightDraft - weightStep) * 2) / 2));
  }
  function incWeight() {
    setWeightDraft(Math.round((weightDraft + weightStep) * 2) / 2);
  }
  function decReps() {
    setRepsDraft(Math.max(0, repsDraft - 1));
  }
  function incReps() {
    setRepsDraft(repsDraft + 1);
  }

  async function handleLogSet() {
    const result = editingSessionId
      ? await logSetIntoSession(editingSessionId, { exerciseId: exercise.id, weight: weightDraft, reps: repsDraft })
      : await logLiveSet(personId, { exerciseId: exercise.id, weight: weightDraft, reps: repsDraft });

    if (!editingSessionId) {
      startRestTimer(personId, 90);
      await refetchLiveSession();
    }
    if (result.isPR) {
      showCelebration({
        exerciseName: exercise.name,
        setText: `${weightDraft} ${defaultUnit} × ${repsDraft}`,
        est1rmText: `${result.best.est1rm} ${defaultUnit}`,
      });
    }
    await Promise.all([refetchSummary(), refetchSessionSets()]);
  }

  async function handleDeleteSet(setId) {
    await deleteSet(setId);
    await Promise.all([refetchSummary(), refetchSessionSets()]);
  }

  const lastLabel = summary?.lastSession ? formatDateLabel(toLocalDateStr(summary.lastSession.startedAt)) : '';
  const lastSetsText = summary?.lastSession
    ? summary.lastSession.sets.map((s) => `${s.weight}${s.unit || 'lb'}×${s.reps}`).join('  ')
    : 'No sets yet';
  const bestText = summary?.best ? `${summary.best.est1rm} ${summary.best.unit}  (${summary.best.weight}${summary.best.unit}×${summary.best.reps})` : 'No PR yet';

  const bestComparableLb = summary?.best ? toLb(summary.best.est1rm, summary.best.unit) : null;

  return (
    <div>
      <button onClick={onBack} style={backButtonStyle}>
        &larr; All exercises
      </button>

      <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.01em', marginBottom: 4 }}>{exercise.name}</div>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
        <div style={{ fontSize: 14, color: 'var(--color-muted)' }}>{exercise.categoryName}</div>
        {exercise.setupFields.map((field) => {
          const found = setupValues.find((v) => v.fieldId === field.id);
          const value = found?.value || '';
          return (
            <button
              key={field.id}
              onClick={() => setEditingSetupField({ fieldId: field.id, fieldName: field.name, value })}
              style={{
                flexShrink: 0,
                padding: '5px 12px',
                borderRadius: 999,
                border: `1px solid ${value ? 'var(--color-border)' : 'var(--color-pr-border)'}`,
                background: value ? 'var(--color-bg)' : 'var(--color-pr-bg)',
                color: value ? 'var(--color-text)' : 'var(--color-pr-text)',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {value ? `${field.name}: ${value}` : `${field.name}: set`}
            </button>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: 16 }}>
          <div style={cardLabelStyle}>Last time &middot; {lastLabel}</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{lastSetsText}</div>
        </div>
        <div style={{ background: 'var(--color-pr-bg)', border: '1px solid var(--color-pr-border)', borderRadius: 16, padding: 16 }}>
          <div style={{ ...cardLabelStyle, color: 'var(--color-pr-text)' }}>Best &middot; Est. 1RM</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-pr-text)' }}>{bestText}</div>
        </div>
      </div>

      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: 20, marginBottom: 16 }}>
        <WeightRepsStepper
          label={`Weight (${defaultUnit})`}
          value={weightDraft}
          onDec={decWeight}
          onInc={incWeight}
          onValueTap={() => setKeypadField('weight')}
        />
        <WeightRepsStepper label="Reps" value={repsDraft} onDec={decReps} onInc={incReps} onValueTap={() => setKeypadField('reps')} />
        <Button
          onClick={handleLogSet}
          style={{
            width: '100%',
            padding: 16,
            background: 'var(--color-accent)',
            color: '#fff',
            border: 'none',
            borderRadius: 12,
            fontSize: 16,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Log set
        </Button>
      </div>

      {sessionSets.length > 0 && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: '8px 20px' }}>
          {sessionSets.map((set, i) => {
            const isPR = isPrSet(set.weight, set.reps, set.unit, bestComparableLb);
            return (
              <div
                key={set.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '14px 0',
                  borderBottom: i < sessionSets.length - 1 ? '1px solid var(--color-subtle-bg)' : 'none',
                }}
              >
                <button
                  onClick={() => setEditingSet(set)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}
                >
                  <div style={{ fontSize: 13, color: 'var(--color-muted)', fontWeight: 600, width: 44 }}>Set {i + 1}</div>
                  <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--color-text)' }}>
                    {set.weight} {set.unit || 'lb'} &times; {set.reps}
                  </div>
                  {isPR && (
                    <span
                      style={{
                        background: 'var(--color-success-bg)',
                        color: 'var(--color-success)',
                        fontSize: 11,
                        fontWeight: 800,
                        padding: '3px 8px',
                        borderRadius: 999,
                        letterSpacing: '0.03em',
                      }}
                    >
                      PR
                    </span>
                  )}
                </button>
                <button
                  onClick={() => openConfirm('Delete this set?', () => handleDeleteSet(set.id))}
                  style={{ background: 'none', border: 'none', color: 'var(--color-faint)', fontSize: 20, cursor: 'pointer', padding: '4px 8px' }}
                >
                  &times;
                </button>
              </div>
            );
          })}
        </div>
      )}

      {hasActiveRoutine && (
        <button
          onClick={onNextExercise}
          style={{
            width: '100%',
            marginTop: 16,
            padding: 16,
            background: 'var(--color-dark)',
            color: '#fff',
            border: 'none',
            borderRadius: 12,
            fontSize: 16,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          {nextButtonLabel}
        </button>
      )}

      {keypadField && (
        <NumericKeypad
          label={keypadField === 'weight' ? `Weight (${defaultUnit})` : 'Reps'}
          initialValue={keypadField === 'weight' ? weightDraft : repsDraft}
          onCancel={() => setKeypadField(null)}
          onDone={(value) => {
            if (keypadField === 'weight') setWeightDraft(value);
            else setRepsDraft(value);
            setKeypadField(null);
          }}
        />
      )}

      {editingSetupField && (
        <SetupFieldEditorModal
          personId={personId}
          exerciseId={exercise.id}
          field={editingSetupField}
          onClose={() => setEditingSetupField(null)}
          onSaved={() => {
            setEditingSetupField(null);
            refetchSetupValues();
          }}
        />
      )}

      {editingSet && (
        <EditSetModal
          set={editingSet}
          onClose={() => setEditingSet(null)}
          onSaved={() => {
            setEditingSet(null);
            refetchSummary();
            refetchSessionSets();
          }}
        />
      )}
    </div>
  );
}

const backButtonStyle = {
  background: 'none',
  border: 'none',
  color: 'var(--color-accent)',
  fontSize: 15,
  fontWeight: 600,
  cursor: 'pointer',
  padding: '0 0 16px 0',
};

const cardLabelStyle = {
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--color-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: 8,
};
