import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppState } from '../../context/AppStateContext';
import { useAuth } from '../../context/AuthContext';
import { useHistory } from '../../hooks/useHistory';
import { useHistoryWindow } from '../../hooks/useHistoryWindow';
import { useExerciseTagMap } from '../../hooks/useExerciseTagMap';
import { useExerciseFilter } from '../../hooks/useExerciseFilter';
import { downloadPersonCsv } from '../../api/export';
import { formatDateLabel, formatTime, toLocalDateStr } from '../../utils/datetime';
import { buildHistoryPrFlags, historyPrFlagKey } from '../../utils/historyPrFlags';
import { collectTagVocabulary, filterHistorySessions } from '../../utils/exerciseFilter';
import PastSessionModal from './PastSessionModal';
import Button from '../shared/Button';
import Skeleton from '../shared/Skeleton';
import RefreshIndicator from '../shared/RefreshIndicator';
import OfflineDataNotice from '../shared/OfflineDataNotice';
import OfflineDisabledWrap from '../shared/OfflineDisabledWrap';
import EmptyState from '../shared/EmptyState';
import HistoryWindowNotice from '../shared/HistoryWindowNotice';
import { windowLabel } from '../shared/historyWindowCopy';
import SetPillRow from '../shared/SetPillRow';
import ExerciseFilterBar from '../shared/ExerciseFilterBar';
import { tagChipStyle } from '../shared/tagChipStyle';
import { IconNote, IconInbox } from '../shared/icons';

function timeLabelFor(session) {
  if (session.endedAt === null) return `${formatTime(session.startedAt)} · In progress`;
  if (session.endedAt !== session.startedAt) return `${formatTime(session.startedAt)}–${formatTime(session.endedAt)}`;
  return formatTime(session.startedAt);
}

// Thin wrapper: owns the deep-link filter seed (from ExerciseDetail's "View full exercise history" link,
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
  const { history, loading, isFetching, updatedAt } = useHistory(activePersonId);
  const { historyWindow } = useHistoryWindow(activePersonId);
  const { tagsByExerciseId } = useExerciseTagMap(activePersonId);
  const filter = useExerciseFilter(initialExerciseFilter);
  const [showPastSessionModal, setShowPastSessionModal] = useState(false);
  const [scrollToSessionId, setScrollToSessionId] = useState(null);
  const sessionRefs = useRef({});

  const activePersonName = people.find((p) => p.id === activePersonId)?.name || '';

  const prFlags = useMemo(() => buildHistoryPrFlags(history), [history]);

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
        { text: filter.text, selectedTagIds: filter.selectedTagIds, exerciseFilter: filter.exerciseFilter },
        tagsByExerciseId,
      ),
    [history, filter.text, filter.selectedTagIds, filter.exerciseFilter, tagsByExerciseId],
  );

  // 0 while the window request is unanswered, so an empty History with no server answer keeps the
  // original copy rather than guessing. Both branches render something honest; only one is a fact.
  const hiddenFromView = historyWindow?.hiddenSessions ?? 0;

  const totalEntryCount = history.reduce((sum, s) => sum + s.entries.length, 0);
  const matchedEntryCount = filteredSessions.reduce((sum, s) => sum + s.entries.length, 0);

  // Scroll the tapped session back into view once the filtered list has re-rendered, so "see what
  // I did before/after this date" (requirement 4) doesn't strand it off-screen. Guarded for jsdom
  // exactly like LogTab.jsx's routine-pill scroll effect.
  useEffect(() => {
    if (!scrollToSessionId) return;
    const el = sessionRefs.current[scrollToSessionId];
    if (el?.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setScrollToSessionId(null);
  }, [scrollToSessionId, filteredSessions]);

  function handleEdit(session) {
    // `session` is always the ORIGINAL, unfiltered object here -- filterHistorySessions never
    // transforms it, only the `entries` shown alongside it -- so a filtered view can never
    // truncate what gets persisted wholesale into AppStateContext by startEditingSession.
    startEditingSession(session);
    navigate('/app/log');
  }

  function handleFilterToExercise(exerciseId, exerciseName, sessionId) {
    filter.setExerciseFilter({ exerciseId, exerciseName });
    setScrollToSessionId(sessionId);
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
        <OfflineDisabledWrap message="Logging a past workout needs a connection.">
          <button onClick={() => setShowPastSessionModal(true)} className="btn btn-secondary btn-md pressable" style={secondaryButtonStyle}>
            + Log a past workout
          </button>
        </OfflineDisabledWrap>
        <OfflineDisabledWrap message="Exporting needs a connection.">
          <Button onClick={() => downloadPersonCsv(activePersonId)} variant="secondary" style={outlineButtonStyle}>
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

      {!loading && history.length > 0 && (
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
          onBackToLog={() => navigate('/app/log')}
        />
      )}

      {loading &&
        Array.from({ length: 3 }).map((_, i) => (
          <div key={i} style={{ marginBottom: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
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

      {/* Two different empty screens, and telling them apart is the whole point. "No workouts
          logged yet" is simply FALSE for a Free household whose training all predates the window --
          including, acutely, someone who has just logged a past workout at an out-of-window date
          and tapped Done. That flow used to land here and be told the workout did not exist. */}
      {!loading && history.length === 0 && hiddenFromView > 0 && (
        <EmptyState
          icon={IconInbox}
          title={`Nothing in ${windowLabel(historyWindow?.windowStart)}`}
          body={`Everything ${activePersonName} logged before then is part of your full history.`}
          action={<HistoryWindowNotice plan={account?.plan} historyWindow={historyWindow} />}
        />
      )}

      {/* The title is kept verbatim as ONE string: six e2e specs and a unit test assert
          `No workouts logged yet for {Name}.` as a single text node, and several of them guard past
          incidents (free-window-notice, offline-reads, offline-cache-warming, import). Splitting
          the sentence across title and body would break every one of them for a cosmetic gain. */}
      {!loading && history.length === 0 && hiddenFromView === 0 && (
        <EmptyState
          icon={IconInbox}
          title={`No workouts logged yet for ${activePersonName}.`}
          body={`Every workout ${activePersonName} logs lands here, newest first.`}
        />
      )}

      {!loading && history.length > 0 && filteredSessions.length === 0 && (
        <EmptyState
          icon={IconInbox}
          title="No exercises match this filter."
          body="Try a different exercise or tag, or clear the filter above."
        />
      )}

      {!loading &&
        filteredSessions.map(({ session, entries }) => (
          <div
            key={session.id}
            ref={(el) => {
              sessionRefs.current[session.id] = el;
            }}
            style={{ marginBottom: 22 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-muted)' }}>
                {formatDateLabel(toLocalDateStr(session.startedAt))} &middot; {timeLabelFor(session)}
              </div>
              <button onClick={() => handleEdit(session)} style={editLinkStyle}>
                Edit
              </button>
            </div>
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: '4px 20px' }}>
              {entries.map((entry, i) => {
                const entryTags = tagsByExerciseId.get(entry.exerciseId);
                return (
                  <div key={entry.exerciseId} style={{ padding: '14px 0', borderBottom: i < entries.length - 1 ? '1px solid var(--color-subtle-bg)' : 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
                      <button
                        onClick={() => handleFilterToExercise(entry.exerciseId, entry.exerciseName, session.id)}
                        aria-label={`Show only ${entry.exerciseName} in history`}
                        className="name-link"
                        style={exerciseNameLinkStyle}
                      >
                        {entry.exerciseName}
                      </button>
                      {entry.note && (
                        <div
                          title={entry.note}
                          style={{
                            fontSize: 12,
                            fontStyle: 'italic',
                            color: 'var(--color-muted)',
                            minWidth: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            textAlign: 'right',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'flex-end',
                            gap: 'var(--space-1)',
                          }}
                        >
                          {/* Labelled rather than aria-hidden like most icons here: it's
                              the only thing marking this line as a note, and it's what
                              the "no note, no indicator" test asserts on. */}
                          <span role="img" aria-label="Note" style={{ display: 'flex', flexShrink: 0 }}>
                            <IconNote size={12} />
                          </span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{entry.note}</span>
                        </div>
                      )}
                    </div>
                    {entryTags?.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                        {entryTags.map((tag) => (
                          <span key={tag.id} style={tagChipStyle}>
                            {tag.name}
                          </span>
                        ))}
                      </div>
                    )}
                    <SetPillRow sets={entry.sets} prFlags={prFlags.get(historyPrFlagKey(session.id, entry.exerciseId))} />
                  </div>
                );
              })}
            </div>
          </div>
        ))}

      {showPastSessionModal && <PastSessionModal onClose={() => setShowPastSessionModal(false)} />}
    </div>
  );
}

// Was --color-faint (2.07:1 -- effectively unreadable). Empty-state copy is body text
// and belongs on --color-muted; see the token comments in index.css.
const emptyStyle = { textAlign: 'center', padding: 'var(--space-10) var(--space-5)', color: 'var(--color-muted)', fontSize: 'var(--text-base)' };

// "Log a past workout" and "Export data" sit side by side and carry equal weight, but
// used to be given two different treatments -- one filled on --color-subtle-bg, the other
// outlined on --color-surface -- with no rule saying what the difference meant. Both are
// secondary; they now look it. Neither is this screen's primary action.
const secondaryButtonStyle = { flex: 1 };

const outlineButtonStyle = { flex: 1 };

const editLinkStyle = {
  background: 'none',
  border: 'none',
  color: 'var(--color-accent-text)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};

// Only the exercise NAME is the tap target for "filter to this exercise", not the whole row -- a
// scroll gesture that terminates on a large row would otherwise fire a tap, and the row can also
// contain a title-bearing note the user may want to read/select.
//
// Text colour, not accent: an exercise name is the same thing here as on the Log screen, and
// colouring it only on this one tab made the app look like it disagreed with itself -- most
// visibly in dark mode, where these turned orange while Log's stayed white. Discoverability
// comes from the hover underline (.name-link) and the aria-label rather than from hue.
const exerciseNameLinkStyle = {
  background: 'none',
  border: 'none',
  padding: 0,
  margin: 0,
  textAlign: 'left',
  color: 'var(--color-text)',
  fontSize: 'var(--text-base)',
  fontWeight: 'var(--weight-semibold)',
  flexShrink: 0,
  cursor: 'pointer',
};
