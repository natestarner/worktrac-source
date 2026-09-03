import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppState } from '../../context/AppStateContext';
import { useAuth } from '../../context/AuthContext';
import { usePrs } from '../../hooks/usePrs';
import { useHistoryWindow } from '../../hooks/useHistoryWindow';
import { useExerciseTagMap } from '../../hooks/useExerciseTagMap';
import { useExerciseFilter } from '../../hooks/useExerciseFilter';
import { formatDateLabel, toLocalDateStr, formatRestTime } from '../../utils/datetime';
import { collectTagVocabulary, filterPrRows } from '../../utils/exerciseFilter';
import { PR_SORT_OPTIONS, sortPrRows } from '../../utils/prSort';
import Skeleton from '../shared/Skeleton';
import RefreshIndicator from '../shared/RefreshIndicator';
import OfflineDataNotice from '../shared/OfflineDataNotice';
import ExerciseFilterBar from '../shared/ExerciseFilterBar';
import EmptyState from '../shared/EmptyState';
import HistoryWindowNotice from '../shared/HistoryWindowNotice';
import { IconStar } from '../shared/icons';
import { windowLabel } from '../shared/historyWindowCopy';
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
  const { activePersonId, prsSort, setPrsSort } = useAppState();
  const { people, account } = useAuth();
  const { prs, loading, isFetching, updatedAt } = usePrs(activePersonId);
  const { historyWindow } = useHistoryWindow(activePersonId);
  const { tagsByExerciseId } = useExerciseTagMap(activePersonId);
  const filter = useExerciseFilter();
  const activePersonName = people.find((p) => p.id === activePersonId)?.name || '';
  const hiddenFromView = historyWindow?.hiddenSessions ?? 0;
  // Named on this tab specifically, because a board of "bests" that silently covers only part of a
  // training life is the most misleading of the three clamped screens: the number on the row is a
  // real record, just not necessarily the person's real record.
  const prsLead = `Bests here cover ${windowLabel(historyWindow?.windowStart)}.`;

  const allExerciseIds = useMemo(() => prs.map((pr) => pr.exerciseId), [prs]);
  const tagVocabulary = useMemo(
    () => collectTagVocabulary(tagsByExerciseId, allExerciseIds),
    [tagsByExerciseId, allExerciseIds],
  );
  // Sort after filtering, not before: the sort is over whatever survived the filter, and sorting
  // the full list first would be thrown away on every keystroke.
  const filteredPrs = useMemo(
    () =>
      sortPrRows(
        filterPrRows(
          prs,
          { text: filter.text, selectedTagIds: filter.selectedTagIds, exerciseFilter: filter.exerciseFilter },
          tagsByExerciseId,
        ),
        prsSort,
      ),
    [prs, filter.text, filter.selectedTagIds, filter.exerciseFilter, tagsByExerciseId, prsSort],
  );

  // Jumping to History pre-filtered to this exercise reuses the same deep-link machinery as
  // ExerciseDetail's "View full exercise history" link (see HistoryTab.jsx) -- just without fromLog, since
  // there's no exercise-logging screen to offer a "Back to" link for on this path.
  function handleRowTap(pr) {
    navigate('/app/history', { state: { historyExerciseFilter: { exerciseId: pr.exerciseId, exerciseName: pr.exerciseName } } });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <RefreshIndicator show={isFetching && !loading} />
      <OfflineDataNotice updatedAt={updatedAt} />

      {!loading && prs.length > 0 && (
        <HistoryWindowNotice plan={account?.plan} historyWindow={historyWindow} lead={prsLead} />
      )}

      {!loading && prs.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label htmlFor="prs-sort" style={{ fontSize: 13, color: 'var(--color-muted)', fontWeight: 600 }}>
              Sort
            </label>
            {/* A native select rather than the SegmentedToggle the Trends switchers use: three
                labels this long don't fit a phone-width segmented control, and sort is a
                set-and-forget preference rather than something you flick between mid-workout. */}
            <select
              id="prs-sort"
              value={prsSort}
              onChange={(e) => setPrsSort(e.target.value)}
              style={sortSelectStyle}
            >
              {PR_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

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
        </>
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

      {/* "Log a set and the board starts filling in" is advice that cannot work for someone whose sets are all
          behind the window -- they have already done the thing it asks for. */}
      {!loading && prs.length === 0 && hiddenFromView > 0 && (
        <EmptyState
          icon={IconStar}
          title="No records inside this window"
          body={`${activePersonName}'s earlier bests are part of your full history.`}
          action={
            <HistoryWindowNotice plan={account?.plan} historyWindow={historyWindow} lead={prsLead} />
          }
        />
      )}

      {!loading && prs.length === 0 && hiddenFromView === 0 && (
        <EmptyState
          icon={IconStar}
          title={`No PRs yet for ${activePersonName}.`}
          body="Log a set and the board starts filling in."
        />
      )}

      {!loading && prs.length > 0 && filteredPrs.length === 0 && (
        <EmptyState
          icon={IconStar}
          title="No exercises match this filter."
          body="Try a different exercise or tag, or clear the filter above."
        />
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
                {pr.best.durationSeconds != null ? (
                  <>
                    {/* A hold has no est. 1RM (BestDto sends null), so the record IS the time. */}
                    <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--color-pr-text)' }}>
                      {formatRestTime(pr.best.durationSeconds)}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--color-muted)' }}>
                      {pr.best.weight > 0 ? `Longest hold at ${pr.best.weight}${pr.best.unit}` : 'Longest hold'}
                    </div>
                  </>
                ) : pr.best.weight === 0 ? (
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

// Was --color-faint (2.07:1 -- effectively unreadable). Empty-state copy is body text
// and belongs on --color-muted; see the token comments in index.css.

// 16px avoids iOS Safari's zoom-on-focus, same reason as ExerciseFilterBar's search input.
const sortSelectStyle = {
  padding: '8px 10px',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
  fontSize: 16,
  fontWeight: 600,
};

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
