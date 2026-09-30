import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useIsRestoring, useQueryClient } from '@tanstack/react-query';
import { useAppState } from '../../context/AppStateContext';
import { useAuth } from '../../context/AuthContext';
import { useHistory } from '../../hooks/useHistory';
import { useHistoryWindow } from '../../hooks/useHistoryWindow';
import { useExerciseTagMap } from '../../hooks/useExerciseTagMap';
import { useExerciseFilter } from '../../hooks/useExerciseFilter';
import { downloadPersonCsv } from '../../api/export';
import { refreshHistory } from '../../lib/queryClient';
import { takeHistoryReload } from '../../lib/historyReload';
import { formatDateLabel, formatTime, toLocalDateStr } from '../../utils/datetime';
import { buildHistoryPrFlags, historyPrFlagKey } from '../../utils/historyPrFlags';
import { collectTagVocabulary, filterHistorySessions, sessionDaySpan, sessionMatchesDateRange } from '../../utils/exerciseFilter';
import { eachDay, formatDateRangeLabel, normalizeRange, startOfMonth, todayStr } from '../../utils/dateRange';
import { prSpec, SET_PR_TYPES, SESSION_PR_TYPES } from '../trends/exerciseMetrics';
import PastSessionModal from './PastSessionModal';
import PullToRefresh from './PullToRefresh';
import { jumpAndSettle } from './jumpAndSettle';
import { useGrowingList } from './useGrowingList';
import BackLink from '../shared/BackLink';
import Button from '../shared/Button';
import Modal from '../shared/Modal';
import Skeleton from '../shared/Skeleton';
import RefreshIndicator from '../shared/RefreshIndicator';
import OfflineDataNotice from '../shared/OfflineDataNotice';
import OfflineDisabledWrap from '../shared/OfflineDisabledWrap';
import ReadOnlyWrap from '../shared/ReadOnlyWrap';
import EmptyState from '../shared/EmptyState';
import HistoryWindowNotice from '../shared/HistoryWindowNotice';
import { windowLabel } from '../shared/historyWindowCopy';
import SetPillRow from '../shared/SetPillRow';
import PrBadge, { prBadgeLabel } from '../shared/PrBadge';
import ExerciseFilterBar from '../shared/ExerciseFilterBar';
import { IconCalendar, IconChevronRight, IconDownload, IconHelp, IconNote, IconPlus, IconScroll, IconTrendingUp } from '../shared/icons';

// Whether a searched date ends before the Free window's first visible day, while the server says
// something IS hidden. Only then is "no workouts that day" possibly untrue. The window start is an
// instant, so it is compared as the local day it falls on, the same way every session is.
function beforeWindow(dateRange, historyWindow) {
  if (!dateRange || !historyWindow?.windowStart || !(historyWindow.hiddenSessions > 0)) return false;
  return normalizeRange(dateRange).to < toLocalDateStr(historyWindow.windowStart);
}

function timeLabelFor(session) {
  if (session.endedAt === null) return `${formatTime(session.startedAt)} · In progress`;
  if (session.endedAt !== session.startedAt) return `${formatTime(session.startedAt)}–${formatTime(session.endedAt)}`;
  return formatTime(session.startedAt);
}

// The session header. A finished workout that crossed midnight names BOTH days --
// "Sep 12, 11:30 PM – Sep 13, 12:40 AM" -- because a date search finds it under either, and
// finding it under Sep 13 beneath a header that says only "Sep 12" reads as the app getting the
// date wrong. Everything else keeps the one-date form.
function sessionHeaderLabel(session) {
  const startDay = toLocalDateStr(session.startedAt);
  if (session.endedAt !== null && toLocalDateStr(session.endedAt) !== startDay) {
    return (
      `${formatDateLabel(startDay)}, ${formatTime(session.startedAt)} – ` +
      `${formatDateLabel(toLocalDateStr(session.endedAt))}, ${formatTime(session.endedAt)}`
    );
  }
  return `${formatDateLabel(startDay)} · ${timeLabelFor(session)}`;
}

// Thin wrapper: owns the deep-link filter seed (from ExerciseDetail's "View exercise history" link,
// or a PR row tap -- see LogTab.jsx / PRsTab.jsx) and the key={activePersonId} remount that
// isolates HistoryTabContent's local filter/modal state per person, mirroring the identical
// pattern at LogTab.jsx's <ExerciseDetail key={activePersonId} />.
//
// Requirement 5 (filters clear on navigate-away) is mostly free: a route change unmounts this
// tree. But a PERSON switch does NOT unmount it -- AppShell just navigates to that person's
// lastTab, which can resolve to the same route -- so the key remount is what isolates the filter
// across a person switch too.
export default function HistoryTab() {
  const { activePersonId } = useAppState();
  const location = useLocation();
  const navigate = useNavigate();

  // Router-state seed, consumed exactly once. React Router persists location.state into
  // window.history.state, so without scrubbing it the filter would reappear on reload and on
  // browser Back -- and AppShell's tryForceUpdate can force a reload on an ordinary tab switch.
  // That would visibly violate requirement 5.
  const [seed, setSeed] = useState(() => location.state?.historyExerciseFilter ?? null);
  useEffect(() => {
    if (!location.state?.historyExerciseFilter) return;
    navigate(location.pathname, { replace: true, state: null }); // scrub the history entry
    setSeed(null); // scrub our own copy
    // One-shot consume-on-mount, not a reactive sync against location.state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <HistoryTabContent key={activePersonId} initialExerciseFilter={seed} />;
}

function HistoryTabContent({ initialExerciseFilter }) {
  const navigate = useNavigate();
  const { activePersonId, startEditingSession } = useAppState();
  const { people, account } = useAuth();
  const { history, loading, isFetching, updatedAt, held, isPaused, isError } = useHistory(activePersonId);
  // History has never reached this device and is not coming right now: its first load is paused
  // (offline) or failing (lie-fi, a struggling backend). `history` is then an empty list, and every
  // empty state below would tell someone with years of workouts they have none -- reproduced on
  // lower with a 1,828-workout account: "No workouts logged yet for Nate." Same registered
  // divergence as PRsTab's and TrendsTab's (.claude/rules/resilience.md), keyed on History's own
  // query, not on connectivity. `held === false` rather than `!held`: only the real hook says.
  const unavailable = held === false && (isPaused || isError);
  const { historyWindow } = useHistoryWindow(activePersonId);
  const { tagsByExerciseId } = useExerciseTagMap(activePersonId);
  const filter = useExerciseFilter(initialExerciseFilter);
  const [showPastSessionModal, setShowPastSessionModal] = useState(false);
  // The row whose destination chooser is open, or null -- one modal for the whole list rather
  // than one per row, mirroring PRsTab's identical `navTarget` (see its header comment for why a
  // record/entry now leads two useful places and neither is obviously the default).
  const [navTarget, setNavTarget] = useState(null);
  const [scrollToSessionId, setScrollToSessionId] = useState(null);
  const sessionRefs = useRef({});

  // The whole History again, for the person on screen, when they ask for it: a reload of this tab,
  // or a pull down on it in the installed app (lib/historyReload.js). Nothing else re-downloads
  // everything -- the month sync trusts what it holds. After the persisted cache is restored, so the
  // re-download lands on top of it rather than racing it.
  const queryClient = useQueryClient();
  const isRestoring = useIsRestoring();
  const tabRef = useRef(null);
  const refreshAllHistory = useCallback(
    () => refreshHistory(queryClient, activePersonId, null, { full: true }),
    [queryClient, activePersonId],
  );
  useEffect(() => {
    if (!isRestoring && takeHistoryReload()) refreshAllHistory();
  }, [isRestoring, refreshAllHistory]);

  const activePersonName = people.find((p) => p.id === activePersonId)?.name || '';

  // Two lookups out of one fold: setMarks badges individual set pills (est. 1RM, top weight),
  // sessionMarks badges the exercise ENTRY header (session volume) -- a session total is not a
  // property of any one set, so picking one to star would be a lie. See historyPrFlags.js.
  const { setMarks: prSetMarks, sessionMarks: prSessionMarks } = useMemo(
    () => buildHistoryPrFlags(history),
    [history],
  );



  const allExerciseIds = useMemo(() => {
    const ids = new Set();
    for (const session of history) for (const entry of session.entries) ids.add(entry.exerciseId);
    return ids;
  }, [history]);

  const tagVocabulary = useMemo(
    () => collectTagVocabulary(tagsByExerciseId, allExerciseIds),
    [tagsByExerciseId, allExerciseIds],
  );

  const filteredSessions = useMemo(
    () =>
      filterHistorySessions(
        history,
        {
          text: filter.text,
          selectedTagIds: filter.selectedTagIds,
          exerciseFilter: filter.exerciseFilter,
          dateRange: filter.dateRange,
        },
        tagsByExerciseId,
      ),
    [history, filter.text, filter.selectedTagIds, filter.exerciseFilter, filter.dateRange, tagsByExerciseId],
  );

  // What the date picker needs from history, folded once: how many workouts each local day holds
  // (its dots), and the earliest day, which bounds how far back it pages -- there is nothing to
  // find before a person's first workout, so "Previous month" stops there rather than paging
  // through empty months.
  //
  // A workout counts on EVERY day it ran across (sessionDaySpan), the same rule the search uses,
  // so the dots and the results can never disagree: a workout from 11:30 PM Friday to 12:40 AM
  // Saturday dots both days, and searching either finds it.
  //
  // Derived from the cached `history`, like everything else on this tab, so the dots are the same
  // online and offline -- there is no date-search request to fail.
  const { workoutCounts, dateBounds } = useMemo(() => {
    const counts = new Map();
    let earliest = null;
    for (const session of history) {
      const span = sessionDaySpan(session);
      for (const day of eachDay(span.from, span.to)) counts.set(day, (counts.get(day) || 0) + 1);
      if (!earliest || span.from < earliest) earliest = span.from;
    }
    const today = todayStr();
    return { workoutCounts: counts, dateBounds: { min: earliest ? startOfMonth(earliest) : startOfMonth(today), max: today } };
  }, [history]);

  // Whether the date alone rules everything out, as opposed to the date plus a text/tag filter.
  // The two need different empty states: "nothing on that day" versus "nothing on that day matches".
  const dateHasNoWorkouts = !!filter.dateRange && !history.some((s) => sessionMatchesDateRange(s, filter.dateRange));

  // Whether anything CURRENTLY ON SCREEN is badged. The legend explains three glyphs; a key to
  // marks that aren't there explains nothing and costs a row of vertical space on every visit.
  //
  // Derived from `filteredSessions`, not from all of `history`, so the legend can never claim to
  // explain marks the filter has hidden. In practice the common case it removes is the genuinely
  // empty one -- a person with no history at all -- because any first-ever set of an exercise IS
  // a record, so almost any history contains at least one badge.
  const hasAnyRecordMark = useMemo(() => {
    for (const { session, entries } of filteredSessions) {
      for (const entry of entries) {
        const key = historyPrFlagKey(session.id, entry.exerciseId);
        if ((prSessionMarks.get(key) || []).length > 0) return true;
        if ((prSetMarks.get(key) || []).some((marks) => marks.length > 0)) return true;
      }
    }
    return false;
  }, [filteredSessions, prSetMarks, prSessionMarks]);

  // 0 while the window request is unanswered, so an empty History with no server answer keeps the
  // original copy rather than guessing. Both branches render something honest; only one is a fact.
  const hiddenFromView = historyWindow?.hiddenSessions ?? 0;

  // Only the newest workouts are drawn at first, and more as the end of the list scrolls near
  // (useGrowingList.js has the measurements). Everything above reads the whole History.
  const { shown, more, sentinelRef, showThrough } = useGrowingList(filteredSessions.length);

  const totalEntryCount = history.reduce((sum, s) => sum + s.entries.length, 0);
  const matchedEntryCount = filteredSessions.reduce((sum, s) => sum + s.entries.length, 0);

  // Scroll the tapped session back into view once the filtered list has re-rendered, so "see what
  // I did before/after this date" (requirement 4) doesn't strand it off-screen. Guarded for jsdom
  // exactly like LogTab.jsx's routine-pill scroll effect.
  //
  // ⚠️ An INSTANT jump, then one correction a frame later, never a smooth scroll. The blocks skip
  // rendering while off screen (.history-block in index.css), so a block that was never drawn has only its
  // estimated height. A smooth scroll fixes its destination from those estimates up front, then
  // draws every block it passes at its real height, which moves the target mid-flight: a workout
  // ten months down landed a whole workout off screen (history-long-list.spec.ts, before the scroll
  // margin below, whose slack now hides most of that miss). An instant jump draws nothing on the
  // way and the corrections absorb the target's neighbours resizing -- it landed exactly even with a
  // deliberately wrong 20px estimate.
  //
  // ⚠️ Correct UNTIL THE TARGET HOLDS STILL, not once (jumpAndSettle). Blocks keep resizing after
  // the jump as they draw: one never drawn has only its estimate, and one drawn before a filter
  // remembers its UNFILTERED height (`auto` in containIntrinsicSize) until it draws again. Chrome
  // keeps the target in place through that (scroll anchoring); Safari has no scroll anchoring, so
  // everything below a resizing block moves. With one correction, "View this exercise's history" two
  // years down a five-year History landed 301px off in WebKit (3/3 locally; 117px under the tab bar
  // on lower, the barrage's long-jump). Re-aiming until it held still landed it exactly (4/4).
  //
  // The loop's cancel lives in a ref, not this effect's cleanup: clearing scrollToSessionId below
  // re-runs the effect, and a cleanup would cancel the loop on the very next render.
  const cancelJump = useRef(null);
  useEffect(() => () => cancelJump.current?.(), []);
  useEffect(() => {
    if (!scrollToSessionId) return;
    // A workout not drawn yet is drawn first; this runs again once it is.
    const index = filteredSessions.findIndex(({ session }) => session.id === scrollToSessionId);
    if (index >= shown) {
      showThrough(index);
      return;
    }
    const el = sessionRefs.current[scrollToSessionId];
    if (el?.scrollIntoView) {
      cancelJump.current?.();
      cancelJump.current = jumpAndSettle(el);
    }
    setScrollToSessionId(null);
  }, [scrollToSessionId, filteredSessions, shown, showThrough]);

  // Stable across renders (useCallback), like every prop SessionBlock takes -- see its header.
  const handleEdit = useCallback(
    (session) => {
      // `session` is always the ORIGINAL, unfiltered object here -- filterHistorySessions never
      // transforms it, only the `entries` shown alongside it -- so a filtered view can never
      // truncate what gets persisted wholesale into AppStateContext by startEditingSession.
      startEditingSession(session);
      navigate('/app/log');
    },
    [startEditingSession, navigate],
  );

  const setSessionRef = useCallback((sessionId, el) => {
    sessionRefs.current[sessionId] = el;
  }, []);

  function handleFilterToExercise(exerciseId, exerciseName, sessionId) {
    filter.setExerciseFilter({ exerciseId, exerciseName });
    setScrollToSessionId(sessionId);
  }

  // The chooser's other destination -- same router-state seed PRsTab's "View progress" hands
  // Trends, so the two entry points can't disagree about how that seed is shaped.
  function goProgress(exerciseId) {
    navigate('/app/trends', { state: { trendsExerciseFocus: { exerciseId } } });
  }

  // Shared by the header line's own button AND the floating chevron hit-zone below -- two
  // controls, one action, so they can never drift on what they open.
  const openExerciseOptions = useCallback((entry, session) => {
    setNavTarget({ exerciseId: entry.exerciseId, exerciseName: entry.exerciseName, sessionId: session.id });
  }, []);

  return (
    <div ref={tabRef}>
      <PullToRefresh targetRef={tabRef} onRefresh={refreshAllHistory} />
      {/* The same refresh for anyone who can't pull: off-screen until focused, like the skip link.
          A browser's own reload does it too, but the installed app has none. */}
      <button type="button" className="skip-link" onClick={refreshAllHistory}>
        Refresh History
      </button>
      {/* The way back from the Log screen's "View exercise history" link. First on the page,
          where a back link is looked for, and outside the controls block below: that block renders
          only once History has loaded and holds something, and the way back should not wait on
          either. A BackLink, like every other back link in the app. */}
      {filter.exerciseFilter?.fromLog && (
        <BackLink onClick={() => navigate('/app/log')}>&larr; Back to {filter.exerciseFilter.exerciseName}</BackLink>
      )}
      <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
        {/* ReadOnlyWrap nests INSIDE OfflineDisabledWrap so the read-only message wins when both
            apply -- see ReadOnlyWrap's header. Telling a member this "needs a connection" would
            send them hunting for signal over something no connection fixes. */}
        <OfflineDisabledWrap message="Logging a past workout needs a connection.">
          <ReadOnlyWrap personId={activePersonId}>
            <button onClick={() => setShowPastSessionModal(true)} className="btn btn-secondary btn-md pressable" style={secondaryButtonStyle}>
              <IconPlus size={16} />
              Log a past workout
            </button>
          </ReadOnlyWrap>
        </OfflineDisabledWrap>
        {/* Deliberately NOT ReadOnlyWrapped. A per-person export is a READ of data the caller can
            already see, and it follows VIEW server-side (ExportController's personScoped route) --
            so a member can always take their own workouts out, and can export a sibling they are
            allowed to see. The whole-household zip is the one that is owner-only; keeping the two
            apart is what stops "members can see everyone" becoming "any member can walk out with
            the household's complete history in one click". */}
        <OfflineDisabledWrap message="Exporting needs a connection.">
          <Button
            onClick={() => downloadPersonCsv(activePersonId)}
            variant="secondary"
            style={outlineButtonStyle}
            // hiddenFromView > 0 covers a Free household whose only sessions are past the window --
            // still nothing on screen, but the export is full-history and unclamped, so there IS
            // something to download. Mirrors the empty-state split below, not just history.length.
            disabled={!unavailable && history.length === 0 && hiddenFromView === 0}
            title={!unavailable && history.length === 0 && hiddenFromView === 0 ? 'Nothing to export yet.' : undefined}
          >
            <IconDownload size={16} />
            Export data
          </Button>
        </OfflineDisabledWrap>
      </div>

      <RefreshIndicator show={isFetching && !loading} />
      <OfflineDataNotice updatedAt={updatedAt} />

      {/* Above the list, not below it: someone should know their history is clipped before they
          read it and conclude it is complete. It renders nothing at all unless something really is
          hidden, so a Free household inside the window sees no change here. */}
      {!loading && history.length > 0 && (
        <HistoryWindowNotice plan={account?.plan} historyWindow={historyWindow} />
      )}

      {/* The controls block: search, tags, and the key to the badges below. Its rows sit
          --space-3 apart and the whole block sits --space-6 above the first session, so it reads
          as one toolbar over the list rather than as more list. The legend lives here, not after
          the empty states, because it is a key to the content -- it belongs with the controls. */}
      {!loading && history.length > 0 && (
        <div style={controlsBlockStyle}>
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
            matchCount={matchedEntryCount}
            totalCount={totalEntryCount}
            dateRange={filter.dateRange}
            onDateRangeChange={filter.setDateRange}
            workoutCounts={workoutCounts}
            dateBounds={dateBounds}
          />
          {hasAnyRecordMark && <RecordLegend />}
        </div>
      )}

      {loading &&
        Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="history-block">
            <div className="history-block-header">
              <Skeleton width={150} height={14} />
              <Skeleton width={32} height={13} />
            </div>
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
        ))}

      {/* Not "no workouts": nothing is known here yet. It clears by itself when History arrives. */}
      {unavailable && (
        <EmptyState
          icon={IconScroll}
          title="History needs a connection"
          body={`${activePersonName ? `${activePersonName}’s` : 'These'} workouts haven’t downloaded to this device yet. You can still log sets; once they download, History works offline too.`}
        />
      )}

      {/* Two different empty screens, and telling them apart is the whole point. "No workouts
          logged yet" is simply FALSE for a Free household whose training all predates the window --
          including, acutely, someone who has just logged a past workout at an out-of-window date
          and tapped Done. That flow used to land here and be told the workout did not exist. */}
      {!loading && !unavailable && history.length === 0 && hiddenFromView > 0 && (
        <EmptyState
          icon={IconScroll}
          title={`Nothing in ${windowLabel(historyWindow?.windowStart)}`}
          body={`Everything ${activePersonName} logged before then is part of your full history.`}
          action={<HistoryWindowNotice plan={account?.plan} historyWindow={historyWindow} />}
        />
      )}

      {/* The title is kept verbatim as ONE string: six e2e specs and a unit test assert
          `No workouts logged yet for {Name}.` as a single text node, and several of them guard past
          incidents (free-window-notice, offline-reads, offline-cache-warming, import). Splitting
          the sentence across title and body would break every one of them for a cosmetic gain. */}
      {!loading && !unavailable && history.length === 0 && hiddenFromView === 0 && (
        <EmptyState
          icon={IconScroll}
          title={`No workouts logged yet for ${activePersonName}.`}
          body={`Every workout ${activePersonName} logs lands here, newest first.`}
        />
      )}

      {/* A date with nothing on it gets its own answer, naming the day -- "no exercises match this
          filter" would send someone checking their search text for a typo that isn't there. On
          Free, a day before the visible window is not "no workouts": it may well hold some, in the
          full history, so that case says so and offers the same notice the top of the tab does. */}
      {!loading && history.length > 0 && filteredSessions.length === 0 && dateHasNoWorkouts && (
        <EmptyState
          icon={IconCalendar}
          title={`No workouts on ${formatDateRangeLabel(filter.dateRange)}.`}
          body={
            beforeWindow(filter.dateRange, historyWindow)
              ? `That's before ${windowLabel(historyWindow?.windowStart)}. It's still part of ${activePersonName}'s full history.`
              : 'Days with a dot on the calendar have workouts.'
          }
          action={
            beforeWindow(filter.dateRange, historyWindow) ? (
              <HistoryWindowNotice plan={account?.plan} historyWindow={historyWindow} />
            ) : (
              <Button variant="secondary" size="sm" onClick={() => filter.setDateRange(null)}>
                Show all dates
              </Button>
            )
          }
        />
      )}

      {!loading && history.length > 0 && filteredSessions.length === 0 && !dateHasNoWorkouts && (
        <EmptyState
          icon={IconScroll}
          title="No exercises match this filter."
          body="Try a different exercise or tag, or clear the filter above."
        />
      )}

      {!loading &&
        filteredSessions.slice(0, shown).map(({ session, entries }) => (
          <SessionBlock
            key={session.id}
            session={session}
            entries={entries}
            activePersonId={activePersonId}
            tagsByExerciseId={tagsByExerciseId}
            prSetMarks={prSetMarks}
            prSessionMarks={prSessionMarks}
            onEdit={handleEdit}
            onOptions={openExerciseOptions}
            setSessionRef={setSessionRef}
          />
        ))}

      {/* Where the next page is drawn from: once this comes within reach of the viewport, more
          workouts are drawn. It looks like a workout still loading, so a fling to the bottom that
          outruns it never shows a list that seems to end early. */}
      {!loading && more && (
        <div ref={sentinelRef} data-testid="history-more" aria-hidden="true" className="history-block">
          <div className="history-block-header">
            <Skeleton width={150} height={14} />
          </div>
          <Skeleton height={96} radius={16} />
        </div>
      )}

      {showPastSessionModal && <PastSessionModal onClose={() => setShowPastSessionModal(false)} />}

      {/* The destination chooser -- see PRsTab.jsx's identical `navTarget` modal, which this
          mirrors deliberately: a tapped exercise now leads two useful places (stay here, filtered,
          or jump to its progress chart) and neither is obviously the default. */}
      {navTarget && (
        <Modal title={navTarget.exerciseName} onClose={() => setNavTarget(null)} width={320}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <Button
              variant="primary"
              fullWidth
              onClick={() => {
                handleFilterToExercise(navTarget.exerciseId, navTarget.exerciseName, navTarget.sessionId);
                setNavTarget(null);
              }}
            >
              <IconScroll size={16} />
              View this exercise&rsquo;s history
            </Button>
            <Button variant="secondary" fullWidth onClick={() => goProgress(navTarget.exerciseId)}>
              <IconTrendingUp size={16} />
              View progress
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// One workout on History. Memoized, with every prop stable across renders of the list, so drawing
// the next page (useGrowingList) renders only the new blocks: before this, each page re-rendered
// every block already drawn, and a page's cost grew with how far down the list it was (220ms ->
// 320ms at 4x throttle by the fourth page on a five-year History).
const SessionBlock = memo(function SessionBlock({
  session,
  entries,
  activePersonId,
  tagsByExerciseId,
  prSetMarks,
  prSessionMarks,
  onEdit,
  onOptions,
  setSessionRef,
}) {
  return (
    <div
      ref={(el) => setSessionRef(session.id, el)}
      className="history-block"
      // The one per-block style left inline: it differs per workout. See .history-block.
      style={{ containIntrinsicSize: `auto ${estimatedSessionBlockHeight(entries.length)}px` }}
    >
      <div className="history-block-header">
        <div className="history-block-label">{sessionHeaderLabel(session)}</div>
        <ReadOnlyWrap personId={activePersonId}>
          <button onClick={() => onEdit(session)} className="history-edit">
            Edit
          </button>
        </ReadOnlyWrap>
      </div>
      <div className="history-card">
        {entries.map((entry) => {
          const entryTags = tagsByExerciseId.get(entry.exerciseId);
          return (
            <div key={entry.exerciseId} className="history-entry">
              {/* The header line is the tap target, not the whole entry -- mirroring PRsTab's
                  row, which offers the identical two destinations (see the `navTarget` modal
                  below), but scoped to just the name+badge: the note below wants to stay
                  selectable prose, the sets aren't part of this control, and a scroll gesture
                  that terminates on a large row would otherwise fire a tap. */}
              <button
                onClick={() => onOptions(entry, session)}
                aria-label={`View options for ${entry.exerciseName}`}
                className="pressable history-entry-header"
              >
                {/* The session-level record, leading the entry header rather than a set pill --
                    "the biggest session of this exercise you have ever done" belongs to the
                    whole entry. Glyph-only in its own pill (`PrBadge`'s `pill` prop): the
                    icon+word badge this replaced ran wide enough on a 390px phone to squeeze
                    the note below down to ~47px of text (see the note's own comment below).
                    Leading it, matching where a set pill's own glyph sits, rather than
                    trailing the name as before. flexShrink: 0 so a long name wraps around it
                    instead of squeezing it. */}
                {(prSessionMarks.get(historyPrFlagKey(session.id, entry.exerciseId)) || []).map((type) => (
                  <span key={type} className="history-entry-badge" aria-label={`${prBadgeLabel([type])} for ${entry.exerciseName}`}>
                    <PrBadge type={type} size={12} pill />
                  </span>
                ))}
                <span className="history-entry-name">{entry.exerciseName}</span>
              </button>
              {/* The disclosure indicator, centered on the WHOLE entry (header + sets),
                  matching how it centers on a PRsTab row -- not on the thin header line
                  alone, which would leave it looking pinned to the top of a taller entry
                  with a note, tags, or several sets underneath. It's a SECOND, decorative
                  hit-zone for pointer/touch users, not a second control for anyone else:
                  `aria-hidden` + `tabIndex={-1}` keep it out of the accessibility tree and
                  the keyboard tab order entirely, so a screen reader or keyboard user still
                  finds exactly one thing here -- the header button above, whose accessible
                  name already says what this leads to. `openExerciseOptions` is the same
                  function the header button calls, so the two can never open different
                  chooser targets. 40px (`.icon-btn`) rather than the usual 44px touch
                  target -- the sanctioned dense-row exception, same as every other icon-only
                  control on this list (see frontend-core.md). */}
              <button
                onClick={() => onOptions(entry, session)}
                aria-hidden="true"
                tabIndex={-1}
                className="icon-btn pressable pressable-subtle"
                style={exerciseChevronHitZoneStyle}
              >
                <IconChevronRight size={18} style={{ color: 'var(--color-faint)' }} />
              </button>
              {/* The note gets its OWN full-width line, under the name rather than beside it.
                  In the header row it was the only item that could shrink -- the exercise
                  name is flexShrink: 0 and the record badge has no flex props, while this
                  carried minWidth: 0 + nowrap + ellipsis -- so it absorbed the entire
                  deficit. On a 390px phone with a "Volume" badge present that left it about
                  47px of text; with a long exercise name it left the icon and nothing else.
                  A note you cannot read is the same as a note that isn't there.

                  Clamped to two lines rather than one: it wraps like prose now, and `title`
                  still carries the whole thing for a pointer device. */}
              {entry.note && (
                <div
                  title={entry.note}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 'var(--space-1)',
                    marginBottom: 6,
                    fontSize: 12,
                    fontStyle: 'italic',
                    color: 'var(--color-muted)',
                    minWidth: 0,
                  }}
                >
                  {/* Labelled rather than aria-hidden like most icons here: it's
                      the only thing marking this line as a note, and it's what
                      the "no note, no indicator" test asserts on. */}
                  <span role="img" aria-label="Note" style={{ display: 'flex', flexShrink: 0, marginTop: 2 }}>
                    <IconNote size={12} />
                  </span>
                  <span
                    style={{
                      minWidth: 0,
                      overflow: 'hidden',
                      display: '-webkit-box',
                      WebkitBoxOrient: 'vertical',
                      WebkitLineClamp: 2,
                    }}
                  >
                    {entry.note}
                  </span>
                </div>
              )}
              {entryTags?.length > 0 && (
                <div className="history-entry-tags">
                  {entryTags.map((tag) => (
                    <span key={tag.id} className="tag-label">
                      {tag.name}
                    </span>
                  ))}
                </div>
              )}
              <SetPillRow sets={entry.sets} prMarks={prSetMarks.get(historyPrFlagKey(session.id, entry.exerciseId))} />
            </div>
          );
        })}
      </div>
    </div>
  );
});

// What the three record glyphs mean. There is now exactly ONE record colour (see index.css's
// --color-record-* block), so the glyph is the entire distinction -- which makes a key for them
// worth its space in a way it would not have been when each type also had its own tint.
//
// Shown only when something on screen is actually badged (hasAnyRecordMark). A legend for marks
// that aren't there explains nothing and costs a row on every visit.
//
// ⚠️ These labels repeat the badges' own words, and Playwright matches an accessible name as a
// SUBSTRING -- so the whole strip is one `aria-hidden` block with a single `aria-label` on the
// wrapper. Without that, every `getByTitle(/Personal record/)` / `getByLabel` count on this tab
// would gain three matches that are not records, only a description of them. The information is
// not lost to a screen reader: each badge in the list below carries its own full accessible name.
function RecordLegend() {
  return (
    <div
      role="note"
      aria-label="What the record badges mean: a trophy is an estimated 1RM record, a double chevron is a top weight record, and stacked layers is a session volume record."
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        // Hugs its content rather than spanning the row, on a subtle fill: a key to the badges,
        // set apart from the session headers below. As bare muted text it was the same colour and
        // weight as those headers and read as the first line of the list.
        alignSelf: 'flex-start',
        gap: 'var(--space-1) var(--space-4)',
        padding: 'var(--space-1) var(--space-1) var(--space-1) var(--space-3)',
        background: 'var(--color-subtle-bg)',
        borderRadius: 'var(--radius-md)',
        fontSize: 'var(--text-xs)',
        color: 'var(--color-muted)',
      }}
    >
      {SET_PR_TYPES.concat(SESSION_PR_TYPES).map((type) => (
        <span key={type} aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          <PrBadge type={type} size={13} />
          {prSpec(type)?.badgeLabel}
        </span>
      ))}
      {/* An icon, not the former text link, so the legend stays one compact line instead of
          growing a fourth, wordier item every time it's on screen. Shrunk to 28px the same way
          ChartHelp's trigger is -- below the 44px touch target, acceptable for the same reason:
          the worst case is a missed tap on a link to more explanation, and there is nothing
          destructive beside it to hit by mistake. `aria-label` carries the exact former link
          text, so this is still "How records work" to a screen reader and to the existing
          getByRole('link', { name: 'How records work' }) coverage -- see frontend-core.md's rule
          on converting a text control to an icon one. */}
      <Link
        to="/app/help#history"
        aria-label="How records work"
        title="How records work"
        className="pressable pressable-subtle"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 28,
          height: 28,
          borderRadius: 'var(--radius-full)',
          color: 'var(--color-accent-text)',
        }}
      >
        <IconHelp size={15} aria-hidden="true" />
      </Link>
    </div>
  );
}

// Was --color-faint (2.07:1 -- effectively unreadable). Empty-state copy is body text
// and belongs on --color-muted; see the token comments in index.css.

// "Log a past workout" and "Export data" sit side by side and carry equal weight, but
// used to be given two different treatments -- one filled on --color-subtle-bg, the other
// outlined on --color-surface -- with no rule saying what the difference meant. Both are
// secondary; they now look it. Neither is this screen's primary action.
const secondaryButtonStyle = { flex: 1 };

// The vertical rhythm (design-system.md's "Vertical rhythm"): controls --space-3 apart, the
// controls block --space-6 above the list, a heading --space-2 above what it heads, and one session
// --space-5 above the next. These were 20/18/14/22/10px, none of them the same gap twice.
const controlsBlockStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-3)',
  marginBottom: 'var(--space-6)',
};

// The workout blocks' styles are classes in index.css ("History's workout list"), not style
// objects: React applies an inline style one property at a time, which was ~40% of the script time
// drawing a page of workouts. Only what differs per workout stays inline.
//
// An off-screen block takes its size from `containIntrinsicSize` until it is drawn (see
// .history-block). The `auto` keyword keeps its real size once it has been drawn. The estimate
// matters for a long jump, such as "View this exercise's history" scrolling to a workout far down:
// blocks above the target that were never drawn are only estimates, and a bad estimate lands the
// scroll off target. Fitted to lower's measurements at 390px: one exercise ~153px, four ~370px.
function estimatedSessionBlockHeight(exerciseCount) {
  return 80 + 72 * exerciseCount;
}

const outlineButtonStyle = { flex: 1 };

// Floating over the entry's own reserved right-hand padding (.history-entry's padding-right),
// vertically centered on the WHOLE entry rather than flexed alongside the header line --
// `position: absolute` is what lets it read against the entry's full height (header + sets)
// instead of just the thin line its sibling button occupies. 40px, matching `.icon-btn`'s
// dense-row touch target (see frontend-core.md) rather than the usual 44px. Inline rather than a
// class on purpose: as a class, its transform would lose to .pressable:active's press scale, and
// the chevron would jump half its height on every tap.
const exerciseChevronHitZoneStyle = {
  position: 'absolute',
  top: '50%',
  right: 0,
  transform: 'translateY(-50%)',
};
