import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppState } from '../../context/AppStateContext';
import { useAuth } from '../../context/AuthContext';
import { useHistory } from '../../hooks/useHistory';
import { useExerciseTagMap } from '../../hooks/useExerciseTagMap';
import { useExerciseFilter } from '../../hooks/useExerciseFilter';
import { downloadPersonCsv } from '../../api/export';
import { formatDateLabel, formatTime, toLocalDateStr } from '../../utils/datetime';
import { buildHistoryPrFlags, historyPrFlagKey } from '../../utils/historyPrFlags';
import { collectTagVocabulary, filterHistorySessions } from '../../utils/exerciseFilter';
import PastSessionModal from './PastSessionModal';
import Button from '../shared/Button';
import Skeleton from '../shared/Skeleton';
import RefreshingPill from '../shared/RefreshingPill';
import OfflineDataNotice from '../shared/OfflineDataNotice';
import OfflineDisabledWrap from '../shared/OfflineDisabledWrap';
import SetPillRow from '../shared/SetPillRow';
import ExerciseFilterBar from '../shared/ExerciseFilterBar';
import { tagChipStyle } from '../shared/tagChipStyle';

function timeLabelFor(session) {
  if (session.endedAt === null) return `${formatTime(session.startedAt)} · In progress`;
  if (session.endedAt !== session.startedAt) return `${formatTime(session.startedAt)}–${formatTime(session.endedAt)}`;
  return formatTime(session.startedAt);
}

// Thin wrapper: owns the deep-link filter seed (from ExerciseDetail's "View full history" link,
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
  const { people } = useAuth();
  const { history, loading, isFetching, updatedAt } = useHistory(activePersonId);
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
      <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
        <OfflineDisabledWrap message="Logging a past workout needs a connection.">
          <button onClick={() => setShowPastSessionModal(true)} style={secondaryButtonStyle}>
            + Log a past workout
          </button>
        </OfflineDisabledWrap>
        <OfflineDisabledWrap message="Exporting needs a connection.">
          <Button onClick={() => downloadPersonCsv(activePersonId)} style={outlineButtonStyle}>
            Export data
          </Button>
        </OfflineDisabledWrap>
      </div>

      <RefreshingPill show={isFetching && !loading} />
      <OfflineDataNotice updatedAt={updatedAt} />

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

      {!loading && history.length === 0 && (
        <div style={emptyStyle}>No workouts logged yet for {activePersonName}.</div>
      )}

      {!loading && history.length > 0 && filteredSessions.length === 0 && (
        <div style={emptyStyle}>No exercises match this filter.</div>
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
                          }}
                        >
                          <span style={{ marginRight: 4 }}>📝</span>
                          {entry.note}
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

const emptyStyle = { textAlign: 'center', padding: '60px 20px', color: 'var(--color-faint)', fontSize: 15 };

const secondaryButtonStyle = {
  flex: 1,
  padding: 14,
  background: 'var(--color-subtle-bg)',
  color: 'var(--color-text)',
  border: 'none',
  borderRadius: 12,
  fontSize: 14,
  fontWeight: 700,
  cursor: 'pointer',
};

const outlineButtonStyle = {
  flex: 1,
  padding: 14,
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border)',
  borderRadius: 12,
  fontSize: 14,
  fontWeight: 700,
  cursor: 'pointer',
};

const editLinkStyle = {
  background: 'none',
  border: 'none',
  color: 'var(--color-accent)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};

// Only the exercise NAME is the tap target for "filter to this exercise", not the whole row -- a
// scroll gesture that terminates on a large row would otherwise fire a tap, and the row can also
// contain a title-bearing note the user may want to read/select. Rendering it as a link-styled
// button also solves discoverability for free.
const exerciseNameLinkStyle = {
  background: 'none',
  border: 'none',
  padding: 0,
  margin: 0,
  textAlign: 'left',
  color: 'var(--color-accent)',
  fontSize: 15,
  fontWeight: 700,
  flexShrink: 0,
  cursor: 'pointer',
};
