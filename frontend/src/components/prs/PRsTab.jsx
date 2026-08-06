import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppState } from '../../context/AppStateContext';
import { useAuth } from '../../context/AuthContext';
import { usePrs } from '../../hooks/usePrs';
import { useExerciseTagMap } from '../../hooks/useExerciseTagMap';
import { useExerciseFilter } from '../../hooks/useExerciseFilter';
import { formatDateLabel, toLocalDateStr } from '../../utils/datetime';
import { collectTagVocabulary, filterPrRows } from '../../utils/exerciseFilter';
import Skeleton from '../shared/Skeleton';
import RefreshingPill from '../shared/RefreshingPill';
import OfflineDataNotice from '../shared/OfflineDataNotice';
import ExerciseFilterBar from '../shared/ExerciseFilterBar';
import { tagChipStyle } from '../shared/tagChipStyle';

// Wrapper: same key={activePersonId} remount pattern as HistoryTab (see its header comment) --
// isolates the filter across a person switch even though PRsTab has no deep-link seed of its own
// to consume.
export default function PRsTab() {
  const { activePersonId } = useAppState();
  return <PRsTabContent key={activePersonId} />;
}

function PRsTabContent() {
  const navigate = useNavigate();
  const { activePersonId } = useAppState();
  const { people } = useAuth();
  const { prs, loading, isFetching, updatedAt } = usePrs(activePersonId);
  const { tagsByExerciseId } = useExerciseTagMap(activePersonId);
  const filter = useExerciseFilter();
  const activePersonName = people.find((p) => p.id === activePersonId)?.name || '';

  const allExerciseIds = useMemo(() => prs.map((pr) => pr.exerciseId), [prs]);
  const tagVocabulary = useMemo(
    () => collectTagVocabulary(tagsByExerciseId, allExerciseIds),
    [tagsByExerciseId, allExerciseIds],
  );
  const filteredPrs = useMemo(
    () =>
      filterPrRows(
        prs,
        { text: filter.text, selectedTagIds: filter.selectedTagIds, exerciseFilter: filter.exerciseFilter },
        tagsByExerciseId,
      ),
    [prs, filter.text, filter.selectedTagIds, filter.exerciseFilter, tagsByExerciseId],
  );

  // Jumping to History pre-filtered to this exercise reuses the same deep-link machinery as
  // ExerciseDetail's "View full history" link (see HistoryTab.jsx) -- just without fromLog, since
  // there's no exercise-logging screen to offer a "Back to" link for on this path.
  function handleRowTap(pr) {
    navigate('/app/history', { state: { historyExerciseFilter: { exerciseId: pr.exerciseId, exerciseName: pr.exerciseName } } });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <RefreshingPill show={isFetching && !loading} />
      <OfflineDataNotice updatedAt={updatedAt} />

      {!loading && prs.length > 0 && (
        <ExerciseFilterBar
          text={filter.text}
          onTextChange={filter.setText}
          tagVocabulary={tagVocabulary}
          selectedTagIds={filter.selectedTagIds}
          onToggleTag={filter.toggleTag}
          exerciseFilter={filter.exerciseFilter}
          onClearExercise={() => filter.setExerciseFilter(null)}
          onClearAll={filter.clearAll}
          isActive={filter.isActive}
          matchCount={filteredPrs.length}
          totalCount={prs.length}
        />
      )}

      {loading &&
        Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 16,
              padding: '18px 20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <Skeleton width={130} height={16} style={{ marginBottom: 2 }} />
              <Skeleton width={160} height={13} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              <Skeleton width={80} height={18} />
              <Skeleton width={70} height={13} />
            </div>
          </div>
        ))}

      {!loading && prs.length === 0 && (
        <div style={emptyStyle}>No PRs yet for {activePersonName} &mdash; log a set to start the board.</div>
      )}

      {!loading && prs.length > 0 && filteredPrs.length === 0 && (
        <div style={emptyStyle}>No exercises match this filter.</div>
      )}

      {!loading &&
        filteredPrs.map((pr) => {
          const tags = tagsByExerciseId.get(pr.exerciseId);
          return (
            <button key={pr.exerciseId} onClick={() => handleRowTap(pr)} style={rowButtonStyle}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{pr.exerciseName}</div>
                <div style={{ fontSize: 13, color: 'var(--color-muted)', marginTop: 2 }}>
                  {formatDateLabel(toLocalDateStr(pr.best.sessionStartedAt))}
                </div>
                {tags?.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                    {tags.map((tag) => (
                      <span key={tag.id} style={tagChipStyle}>
                        {tag.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                {pr.best.weight === 0 ? (
                  <>
                    <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--color-pr-text)' }}>{pr.best.reps} reps</div>
                    <div style={{ fontSize: 13, color: 'var(--color-muted)' }}>Bodyweight</div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--color-pr-text)' }}>
                      {pr.best.est1rm} {pr.best.unit}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--color-muted)' }}>
                      {pr.best.weight}
                      {pr.best.unit}×{pr.best.reps}
                    </div>
                  </>
                )}
              </div>
            </button>
          );
        })}
    </div>
  );
}

const emptyStyle = { textAlign: 'center', padding: '60px 20px', color: 'var(--color-faint)', fontSize: 15 };

const rowButtonStyle = {
  width: '100%',
  boxSizing: 'border-box',
  textAlign: 'left',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 16,
  padding: '18px 20px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  cursor: 'pointer',
  font: 'inherit',
  color: 'inherit',
};
