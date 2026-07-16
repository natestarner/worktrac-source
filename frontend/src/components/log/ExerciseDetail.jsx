import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAppState } from '../../context/AppStateContext';
import { useUI } from '../../context/UIContext';
import { getExerciseSummary } from '../../api/stats';
import { listSessionSets, logLiveSet, logSetIntoSession, deleteSet } from '../../api/sets';
import { listSetupValues } from '../../api/setupValues';
import { listCustomFields, favoriteExercise, unfavoriteExercise, removeExercise } from '../../api/exercises';
import { comparableLb, computePrefillDraft, isPrSet } from '../../utils/formulas';
import { formatDateLabel, toLocalDateStr } from '../../utils/datetime';
import WeightRepsStepper from './WeightRepsStepper';
import NumericKeypad from '../shared/NumericKeypad';
import SetupFieldEditorModal from '../shared/SetupFieldEditorModal';
import CustomFieldEditorModal from '../shared/CustomFieldEditorModal';
import ConfigureExerciseModal from '../shared/ConfigureExerciseModal';
import EditSetModal from '../shared/EditSetModal';
import Button from '../shared/Button';
import Skeleton from '../shared/Skeleton';

export default function ExerciseDetail({
  exercise,
  personId,
  personCategories = [],
  onPersonalizationChanged,
  editingSessionId,
  liveSession,
  refetchLiveSession,
  onBack,
}) {
  const { account, people } = useAuth();
  const activePersonName = people.length >= 2 ? people.find((p) => p.id === personId)?.name : null;
  const activePersonFirstName = activePersonName?.split(' ')[0];
  const { weightDraft, repsDraft, setWeightDraft, setRepsDraft } = useAppState();
  const { showCelebration, startRestTimer, openConfirm } = useUI();

  const contextSessionId = editingSessionId || liveSession?.id || null;

  const [summary, setSummary] = useState(null);
  const [sessionSets, setSessionSets] = useState([]);
  const [setupValues, setSetupValues] = useState([]);
  const [customFields, setCustomFields] = useState([]);
  const [keypadField, setKeypadField] = useState(null);
  const [editingSetupField, setEditingSetupField] = useState(null);
  const [editingCustomField, setEditingCustomField] = useState(null);
  const [showConfigureModal, setShowConfigureModal] = useState(false);
  const [editingSet, setEditingSet] = useState(null);
  const [ready, setReady] = useState(false);
  const [justAddedSetId, setJustAddedSetId] = useState(null);

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
  function refetchCustomFields() {
    return listCustomFields(personId, exercise.id).then(setCustomFields);
  }

  useEffect(() => {
    setReady(false);
    Promise.all([refetchSummary(), refetchSessionSets(), refetchSetupValues(), refetchCustomFields()]).finally(() =>
      setReady(true),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercise.id, contextSessionId]);

  async function handleToggleFavorite() {
    if (exercise.isFavorite) await unfavoriteExercise(personId, exercise.id);
    else await favoriteExercise(personId, exercise.id);
    if (onPersonalizationChanged) await onPersonalizationChanged();
  }

  function handleRequestDelete() {
    setShowConfigureModal(false);
    openConfirm(
      `Delete "${exercise.name}"? Already-logged sets for it are kept, but it will disappear from your picker.`,
      async () => {
        await removeExercise(exercise.id);
        if (onPersonalizationChanged) await onPersonalizationChanged();
        onBack();
      },
    );
  }

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

  // Clears the just-added highlight once its animation has had time to finish, so it
  // plays once per set logged rather than lingering or replaying on unrelated re-renders.
  useEffect(() => {
    if (!justAddedSetId) return;
    const timer = setTimeout(() => setJustAddedSetId(null), 1200);
    return () => clearTimeout(timer);
  }, [justAddedSetId]);

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
    setJustAddedSetId(result.set.id);
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

  const bestComparableLb = summary?.best
    ? comparableLb(summary.best.weight, summary.best.reps, summary.best.unit)
    : null;

  return (
    <div>
      <div className="exercise-detail-grid">
        <div>
          <button onClick={onBack} style={backButtonStyle}>
            &larr; All exercises
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: exercise.personCategoryName ? 6 : 18 }}>
            <div style={{ minWidth: 0, fontSize: 26, fontWeight: 700, letterSpacing: '-0.01em' }}>{exercise.name}</div>
            <button
              onClick={handleToggleFavorite}
              aria-label={exercise.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              style={{ ...iconButtonStyle, fontSize: 20, color: exercise.isFavorite ? 'var(--color-accent)' : 'var(--color-faint)' }}
            >
              {exercise.isFavorite ? '★' : '☆'}
            </button>
            <button
              onClick={() => setShowConfigureModal(true)}
              aria-label="Customize this exercise"
              title="Customize this exercise"
              style={{ ...iconButtonStyle, fontSize: 22, fontWeight: 700, color: 'var(--color-muted)' }}
            >
              &#8942;
            </button>
          </div>
          {exercise.personCategoryName && (
            <div style={{ fontSize: 13, color: 'var(--color-muted)', marginBottom: 18 }}>{exercise.personCategoryName}</div>
          )}

          {(exercise.setupFields.length > 0 || customFields.length > 0) && (
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
              {exercise.setupFields.map((field) => {
                const found = setupValues.find((v) => v.fieldId === field.id);
                const value = found?.value || '';
                return (
                  <button
                    key={`base-${field.id}`}
                    onClick={() => setEditingSetupField({ fieldId: field.id, fieldName: field.name, value })}
                    style={setupPillStyle(value)}
                  >
                    {value ? `${field.name}: ${value}` : `${field.name}: set`}
                  </button>
                );
              })}
              {customFields.map((field) => {
                const value = field.value || '';
                return (
                  <button key={`custom-${field.id}`} onClick={() => setEditingCustomField(field)} style={setupPillStyle(value)}>
                    {value ? `${field.name}: ${value}` : `${field.name}: set`}
                  </button>
                );
              })}
            </div>
          )}

          {!ready && (
            <div className="summary-cards-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
              <div className="summary-card" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16 }}>
                <Skeleton width={90} height={11} style={{ marginBottom: 8 }} />
                <Skeleton width={110} height={20} />
              </div>
              <div className="summary-card" style={{ background: 'var(--color-pr-bg)', border: '1px solid var(--color-pr-border)', borderRadius: 16 }}>
                <Skeleton width={100} height={11} style={{ marginBottom: 8 }} />
                <Skeleton width={130} height={20} />
              </div>
            </div>
          )}

          {ready && (
            <div className="summary-cards-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
              <div className="summary-card" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16 }}>
                <div style={cardLabelStyle}>Last time &middot; {lastLabel}</div>
                <div className="summary-card-value" style={{ fontWeight: 700 }}>{lastSetsText}</div>
              </div>
              <div className="summary-card" style={{ background: 'var(--color-pr-bg)', border: '1px solid var(--color-pr-border)', borderRadius: 16 }}>
                <div style={{ ...cardLabelStyle, color: 'var(--color-pr-text)' }}>Best &middot; Est. 1RM</div>
                <div className="summary-card-value" style={{ fontWeight: 700, color: 'var(--color-pr-text)' }}>{bestText}</div>
              </div>
            </div>
          )}

          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: 20, marginBottom: 16 }}>
            <div className="stepper-pair">
              <WeightRepsStepper
                label={`Weight (${defaultUnit})`}
                value={weightDraft}
                onDec={decWeight}
                onInc={incWeight}
                onValueTap={() => setKeypadField('weight')}
              />
              <WeightRepsStepper label="Reps" value={repsDraft} onDec={decReps} onInc={incReps} onValueTap={() => setKeypadField('reps')} />
            </div>
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
              <span
                style={{
                  display: 'block',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {activePersonFirstName ? `Log set for ${activePersonFirstName}` : 'Log set'}
              </span>
            </Button>
          </div>
        </div>

        <div className="log-sets-col">
          {ready && sessionSets.length > 0 && (
            <>
              <div className="log-sets-heading">This session</div>
              <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: '8px 20px' }}>
                {[...sessionSets].reverse().map((set, i) => {
                  // sessionSets comes back from the API in the order logged (oldest
                  // first) so "Set N" always labels a set's true chronological
                  // position -- reverse only the rendering, not the numbering, so the
                  // most recently logged set shows on top.
                  const setNumber = sessionSets.length - i;
                  const isPR = isPrSet(set.weight, set.reps, set.unit, bestComparableLb);
                  return (
                    <div
                      key={set.id}
                      className={set.id === justAddedSetId ? 'set-row-new' : undefined}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '14px 0',
                        borderRadius: 10,
                        borderBottom: i < sessionSets.length - 1 ? '1px solid var(--color-subtle-bg)' : 'none',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ fontSize: 13, color: 'var(--color-muted)', fontWeight: 600, width: 44 }}>Set {setNumber}</div>
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
                      </div>
                      <div style={{ display: 'flex', gap: 14 }}>
                        <button onClick={() => setEditingSet(set)} style={editLinkStyle}>
                          Edit
                        </button>
                        <button onClick={() => openConfirm('Delete this set?', () => handleDeleteSet(set.id))} style={deleteLinkStyle}>
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

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

      {editingCustomField && (
        <CustomFieldEditorModal
          personId={personId}
          exerciseId={exercise.id}
          field={editingCustomField}
          onClose={() => setEditingCustomField(null)}
          onSaved={() => {
            setEditingCustomField(null);
            refetchCustomFields();
          }}
          onDeleted={() => {
            setEditingCustomField(null);
            refetchCustomFields();
          }}
        />
      )}

      {showConfigureModal && (
        <ConfigureExerciseModal
          exercise={exercise}
          personId={personId}
          exerciseId={exercise.id}
          currentCategoryId={exercise.personCategoryId ?? null}
          categories={personCategories}
          customFields={customFields}
          onClose={() => setShowConfigureModal(false)}
          onFieldsChanged={refetchCustomFields}
          onCategoryChanged={onPersonalizationChanged || (() => {})}
          onExerciseChanged={onPersonalizationChanged || (() => {})}
          onRequestDelete={handleRequestDelete}
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
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--color-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: 4,
};

const editLinkStyle = { background: 'none', border: 'none', color: 'var(--color-accent)', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const deleteLinkStyle = { background: 'none', border: 'none', color: 'var(--color-danger)', fontSize: 13, fontWeight: 600, cursor: 'pointer' };

const iconButtonStyle = {
  background: 'none',
  border: 'none',
  padding: 0,
  lineHeight: 1,
  cursor: 'pointer',
  flexShrink: 0,
};

function setupPillStyle(value) {
  return {
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
  };
}
