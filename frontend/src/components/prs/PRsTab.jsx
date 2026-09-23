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
import { PR_SORT_LABELS_ANY_MEASURE, prSortOptions, sortPrRows } from '../../utils/prSort';
import {
  PR_MEASURE_OPTIONS,
  formatPrMeasure,
  measureEntry,
  measureFallback,
  measureUnavailableCaption,
  measureUnavailableTitle,
  prMeasureSpec,
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
              both are set-and-forget preferences rather than something you flick between mid-set.

              ONE row at every width, never wrapping: stacked, the pair spent ~100px of a phone
              screen on two preferences. Each starts at its widest option's width and the two
              share out whatever is left, so they span the row like the search field below. Record
              never shrinks (its longest label is short); on the narrowest phones Sort gives way
              and ellipsizes instead. */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-3)' }}>
            <Select
              id="prs-measure"
              label="Record"
              value={prsMeasure}
              onChange={setPrsMeasure}
              options={PR_MEASURE_OPTIONS}
              style={{ flex: '1 0 auto' }}
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
              sizeToLabels={PR_SORT_LABELS_ANY_MEASURE}
              style={{ flex: '1 1 auto' }}
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
          // What a row that cannot be ranked on this measure shows instead of a dash.
          const fallback = shown ? null : measureFallback(pr, defaultUnit);
          // A session-level record's caption is a full breakdown of the work behind it, which no
          // longer fits a narrow right-hand column now that it is uncapped. Set-level captions are
          // short ("185lb×5") and stay where they were.
          const captionOnOwnLine = !!shown && prMeasureSpec(prsMeasure).pr?.scope === 'session';
          // The date follows the measure, so it always names the day the number above it was set.
          //
          // ⚠️ Optional-chained on `best` like everything else that reads a row here. Every access
          // in prMeasures.js is written this way for resilience.md's axis D -- a row restored from
          // a cache written by an older build -- and this one was the exception: `pr.best.x` on a
          // row with no `best` threw, which unmounts the whole tab rather than degrading the one
          // row. The board must render what it can.
          const dateSource = entry?.sessionStartedAt ?? pr.best?.sessionStartedAt;
          return (
            <button
              key={pr.exerciseId}
              data-testid="pr-row"
              className="pressable"
              onClick={() => setNavTarget(pr)}
              style={rowButtonStyle}
            >
              {/* The two columns live in their own nowrap row, separate from the button's own
                  flow. A long exercise name must SHRINK-AND-WRAP inside its column, not push the
                  value/chevron column onto a line of its own -- those stay exactly where they are
                  regardless of name length. See rowMainStyle's comment for why this has to be a
                  nested flex row rather than flex-wrap on the button itself. */}
              <div style={rowMainStyle}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, overflowWrap: 'anywhere' }}>{pr.exerciseName}</div>
                  {dateSource && (
                    <div style={{ fontSize: 13, color: 'var(--color-muted)', marginTop: 2 }}>
                      {formatDateLabel(toLocalDateStr(dateSource))}
                    </div>
                  )}
                  {tags?.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      {tags.map((tag) => (
                        <span key={tag.id} className="tag-label">
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
                        <div style={{ fontSize: 18, fontWeight: 'var(--weight-bold)', color: 'var(--color-record-text)' }}>
                          {shown.value}
                        </div>
                        {/* A set-level caption only. A session-level one is the whole breakdown and
                            renders full-width below the row instead -- see captionOnOwnLine. */}
                        {!captionOnOwnLine && (
                          <div
                            title={shown.caption}
                            style={{ fontSize: 13, color: 'var(--color-muted)', lineHeight: 1.35 }}
                          >
                            {shown.caption}
                          </div>
                        )}
                      </>
                    ) : (
                      // Never a zero: this exercise cannot be measured this way at all, and a column
                      // of "0 lb" is worse than no column (see .claude/rules/trends.md). But it is no
                      // longer a bare em dash either -- a pull-up has no top weight and still has a
                      // record, and the dash said "nothing here" about a row that has a number. The
                      // fallback is that number (measureFallback), drawn in --color-muted rather than
                      // the record colour so it never reads as the selected measure, with the caption
                      // naming why this measure does not apply. An em dash remains for the genuinely
                      // empty case. `title` is the mouse-user bonus, not the mechanism -- this app is
                      // used on an iPad, where hover does not exist.
                      <div title={measureUnavailableTitle(pr, prsMeasure)}>
                        <div style={{ fontSize: 18, fontWeight: 'var(--weight-bold)', color: 'var(--color-muted)' }}>
                          {fallback ? fallback.value : <>&mdash;</>}
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
              </div>
              {/* The work behind a SESSION-level record, on its own full-width line below
                  rowMainStyle's row -- plain block flow now that the row above is its own nested
                  flex container, rather than a flexBasis: 100% trick against a flex-wrap on the
                  button itself. */}
              {captionOnOwnLine && (
                <div
                  style={{
                    marginTop: 'var(--space-1)',
                    fontSize: 13,
                    lineHeight: 1.35,
                    color: 'var(--color-muted)',
                  }}
                >
                  {shown.caption}
                </div>
              )}
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
              View this exercise&rsquo;s history
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

// Plain block, NOT a flex container -- rowMainStyle owns the flex row now. This used to be
// `display: flex` + `flexWrap: 'wrap'` so the optional session-level caption could take a
// flexBasis: 100% third line under the two columns, but that same flexWrap let a long exercise
// name wrap the value/chevron column onto its OWN new line too: flex-wrap decides line breaks
// from each item's un-shrunk (max-content) width, before flex-shrink ever gets a say, so a name
// wider than the leftover space pushed the whole right-hand column down and (since a lone item on
// a `space-between` line sits at its start) left, instead of shrinking the name in place. See
// rowMainStyle for the fix.
const rowButtonStyle = {
  width: '100%',
  boxSizing: 'border-box',
  textAlign: 'left',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 16,
  padding: '18px 20px',
  cursor: 'pointer',
  font: 'inherit',
  color: 'inherit',
};

// The two-column row, `nowrap` (the default) rather than `wrap`: keeping both columns on ONE flex
// line is what forces the name column to shrink (and its text to wrap internally) instead of the
// whole column wrapping below. The value/chevron column's `flexShrink: 0` then guarantees it never
// gives up so much as a pixel -- shrinking is entirely the name column's job, via its own
// `minWidth: 0` + `overflowWrap: 'anywhere'`.
const rowMainStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
};
