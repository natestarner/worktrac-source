import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppState } from '../../context/AppStateContext';
import { useAuth } from '../../context/AuthContext';
import { usePrs } from '../../hooks/usePrs';
import { useHistoryWindow } from '../../hooks/useHistoryWindow';
import { useExerciseTagMap } from '../../hooks/useExerciseTagMap';
import { useExerciseFilter } from '../../hooks/useExerciseFilter';
import { formatDateLabel, toLocalDateStr } from '../../utils/datetime';
import { collectTagVocabulary, filterPrRows } from '../../utils/exerciseFilter';
import { prSortOptions, sortPrRows } from '../../utils/prSort';
import {
  PR_MEASURE_OPTIONS,
  formatPrMeasure,
  measureEntry,
  measureUnavailableCaption,
  measureUnavailableTitle,
} from './prMeasures';
import { prRecordHelp } from '../trends/chartHelp';
import Skeleton from '../shared/Skeleton';
import RefreshIndicator from '../shared/RefreshIndicator';
import OfflineDataNotice from '../shared/OfflineDataNotice';
import ExerciseFilterBar from '../shared/ExerciseFilterBar';
import EmptyState from '../shared/EmptyState';
import HistoryWindowNotice from '../shared/HistoryWindowNotice';
import ChartHelp from '../shared/ChartHelp';
import Select from '../shared/Select';
import Modal from '../shared/Modal';
import Button from '../shared/Button';
import { IconChevronRight, IconScroll, IconStar, IconTrendingUp } from '../shared/icons';
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
  const { activePersonId, prsSort, setPrsSort, prsMeasure, setPrsMeasure } = useAppState();
  const { people, account } = useAuth();
  const { prs, loading, isFetching, updatedAt } = usePrs(activePersonId);
  const { historyWindow } = useHistoryWindow(activePersonId);
  const { tagsByExerciseId } = useExerciseTagMap(activePersonId);
  const filter = useExerciseFilter();
  // The row whose destination chooser is open, or null. ONE modal for the whole board rather than
  // one per row -- a board can run to dozens of exercises.
  const [navTarget, setNavTarget] = useState(null);
  const activePersonName = people.find((p) => p.id === activePersonId)?.name || '';
  const defaultUnit = account?.defaultUnit || 'lb';
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
        prsMeasure,
      ),
    [prs, filter.text, filter.selectedTagIds, filter.exerciseFilter, tagsByExerciseId, prsSort, prsMeasure],
  );

  // Both destinations are plain client-side navigations over caches these tabs already read --
  // deliberately NOT gated on connectivity, and neither is a write.
  //
  // History reuses the same deep-link machinery as ExerciseDetail's "View full exercise history"
  // link (see HistoryTab.jsx), just without fromLog, since there's no exercise-logging screen to
  // offer a "Back to" link for on this path. Trends mirrors it with its own seed key -- see
  // TrendsTab.jsx, which consumes and scrubs it the same way.
  function goHistory(pr) {
    navigate('/app/history', {
      state: { historyExerciseFilter: { exerciseId: pr.exerciseId, exerciseName: pr.exerciseName } },
    });
  }

  function goProgress(pr) {
    navigate('/app/trends', { state: { trendsExerciseFocus: { exerciseId: pr.exerciseId } } });
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
          {/* Record on the left, Sort on the right: the record decides what every number on the
              board MEANS, the sort only decides their order, so the more consequential control
              reads first. Both are native selects rather than the SegmentedToggle the Trends
              switchers use -- these labels are too long for a phone-width segmented control, and
              both are set-and-forget preferences rather than something you flick between mid-set. */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <Select
              id="prs-measure"
              label="Record"
              value={prsMeasure}
              onChange={setPrsMeasure}
              options={PR_MEASURE_OPTIONS}
            >
              {/* Anchored to the picker it explains: three of these five are a single best set and
                  two are session totals, and nothing on the board shows the difference. */}
              <ChartHelp help={prRecordHelp(prsMeasure)} />
            </Select>

            <Select
              id="prs-sort"
              label="Sort"
              value={prsSort}
              onChange={setPrsSort}
              options={prSortOptions(prsMeasure)}
            />
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
          const entry = measureEntry(pr, prsMeasure);
          const shown = entry ? formatPrMeasure(entry, prsMeasure, pr, defaultUnit) : null;
          // The date follows the measure, so it always names the day the number above it was set.
          const dateSource = entry?.sessionStartedAt ?? pr.best.sessionStartedAt;
          return (
            <button
              key={pr.exerciseId}
              data-testid="pr-row"
              className="pressable"
              onClick={() => setNavTarget(pr)}
              style={rowButtonStyle}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{pr.exerciseName}</div>
                <div style={{ fontSize: 13, color: 'var(--color-muted)', marginTop: 2 }}>
                  {formatDateLabel(toLocalDateStr(dateSource))}
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
              {/* maxWidth, not flexShrink: 0 alone. The caption for a session-level record is now
                  a breakdown of the work behind it ("135lb×10, 3×155lb×8"), which is far longer
                  than the "One session" it replaced -- unbounded it would push the exercise name
                  on the left out of the row on a phone. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, maxWidth: '58%' }}>
                <div style={{ textAlign: 'right', minWidth: 0 }}>
                  {shown ? (
                    <>
                      <div style={{ fontSize: 18, fontWeight: 'var(--weight-bold)', color: 'var(--color-pr-text)' }}>
                        {shown.value}
                      </div>
                      {/* The full, untruncated breakdown for a mouse user; the visible caption is
                          already capped at three runs plus an honest "+N more", because this app
                          is used on an iPad where hover does not exist. */}
                      <div
                        title={shown.caption}
                        style={{ fontSize: 13, color: 'var(--color-muted)', lineHeight: 1.35 }}
                      >
                        {shown.caption}
                      </div>
                    </>
                  ) : (
                    // A dash, never a zero: this exercise cannot be measured this way at all, and a
                    // column of "0 lb" is worse than no column (see .claude/rules/trends.md). The
                    // caption is always visible rather than hover-only -- this app is used on an
                    // iPad, where hover does not exist. `title` is the mouse-user bonus, not the
                    // mechanism.
                    <div title={measureUnavailableTitle(pr, prsMeasure)}>
                      <div style={{ fontSize: 18, fontWeight: 'var(--weight-bold)', color: 'var(--color-muted)' }}>
                        &mdash;
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--color-muted)' }}>
                        {measureUnavailableCaption(pr)}
                      </div>
                    </div>
                  )}
                </div>
                {/* The disclosure indicator. Nothing on this row said it was tappable before --
                    no chevron and (against frontend-core.md's own rule) no `pressable` either, so
                    a pointer device got no hover treatment at all. --color-faint is furniture
                    here, which is one of its sanctioned uses. */}
                <IconChevronRight size={18} style={{ color: 'var(--color-faint)' }} />
              </div>
            </button>
          );
        })}

      {/* A chooser rather than a straight jump, because a record now leads two useful places and
          neither is obviously the default. It is also the extensible shape: another destination is
          a row here, not another control competing for the same 390px. */}
      {navTarget && (
        <Modal title={navTarget.exerciseName} onClose={() => setNavTarget(null)} width={320}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <Button variant="primary" fullWidth onClick={() => goHistory(navTarget)}>
              <IconScroll size={16} />
              View history
            </Button>
            <Button variant="secondary" fullWidth onClick={() => goProgress(navTarget)}>
              <IconTrendingUp size={16} />
              View progress
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// Was --color-faint (2.07:1 -- effectively unreadable). Empty-state copy is body text
// and belongs on --color-muted; see the token comments in index.css.

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
