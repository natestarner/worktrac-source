import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
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
import { prSpec, SET_PR_TYPES, SESSION_PR_TYPES } from '../trends/exerciseMetrics';
import PastSessionModal from './PastSessionModal';
import Button from '../shared/Button';
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
import { tagChipStyle } from '../shared/tagChipStyle';
import { IconNote, IconScroll } from '../shared/icons';

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
        { text: filter.text, selectedTagIds: filter.selectedTagIds, exerciseFilter: filter.exerciseFilter },
        tagsByExerciseId,
      ),
    [history, filter.text, filter.selectedTagIds, filter.exerciseFilter, tagsByExerciseId],
  );

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
        {/* ReadOnlyWrap nests INSIDE OfflineDisabledWrap so the read-only message wins when both
            apply -- see ReadOnlyWrap's header. Telling a member this "needs a connection" would
            send them hunting for signal over something no connection fixes. */}
        <OfflineDisabledWrap message="Logging a past workout needs a connection.">
          <ReadOnlyWrap personId={activePersonId}>
            <button onClick={() => setShowPastSessionModal(true)} className="btn btn-secondary btn-md pressable" style={secondaryButtonStyle}>
              + Log a past workout
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
            disabled={history.length === 0 && hiddenFromView === 0}
            title={history.length === 0 && hiddenFromView === 0 ? 'Nothing to export yet.' : undefined}
          >
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
      {!loading && history.length === 0 && hiddenFromView === 0 && (
        <EmptyState
          icon={IconScroll}
          title={`No workouts logged yet for ${activePersonName}.`}
          body={`Every workout ${activePersonName} logs lands here, newest first.`}
        />
      )}

      {!loading && history.length > 0 && filteredSessions.length === 0 && (
        <EmptyState
          icon={IconScroll}
          title="No exercises match this filter."
          body="Try a different exercise or tag, or clear the filter above."
        />
      )}

      {!loading && hasAnyRecordMark && <RecordLegend />}

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
              <ReadOnlyWrap personId={activePersonId}>
                <button onClick={() => handleEdit(session)} style={editLinkStyle}>
                  Edit
                </button>
              </ReadOnlyWrap>
            </div>
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: '4px 20px' }}>
              {entries.map((entry, i) => {
                const entryTags = tagsByExerciseId.get(entry.exerciseId);
                return (
                  <div key={entry.exerciseId} style={{ padding: '14px 0', borderBottom: i < entries.length - 1 ? '1px solid var(--color-subtle-bg)' : 'none' }}>
                    {/* The badge sits NEXT TO the name, not at the far edge of the row. With the
                        note moved to its own line this row has two children, and `space-between`
                        would fling the badge to the right margin -- visually detached from the
                        exercise it labels, and out of step with the identical row in "Session
                        exercises". Left-grouped, the two surfaces read the same. */}
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)', marginBottom: 4 }}>
                      <button
                        onClick={() => handleFilterToExercise(entry.exerciseId, entry.exerciseName, session.id)}
                        aria-label={`Show only ${entry.exerciseName} in history`}
                        className="name-link"
                        style={exerciseNameLinkStyle}
                      >
                        {entry.exerciseName}
                      </button>
                      {/* The session-level record, on the entry header rather than a set pill --
                          "the biggest session of this exercise you have ever done" belongs to the
                          whole entry. showLabel because, unlike a set pill, there is no number
                          beside it to give the glyph context. */}
                      {(prSessionMarks.get(historyPrFlagKey(session.id, entry.exerciseId)) || []).map((type) => (
                        <span key={type} aria-label={`${prBadgeLabel([type])} for ${entry.exerciseName}`}>
                          <PrBadge type={type} size={12} showLabel />
                        </span>
                      ))}
                    </div>
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
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                        {entryTags.map((tag) => (
                          <span key={tag.id} style={tagChipStyle}>
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
        ))}

      {showPastSessionModal && <PastSessionModal onClose={() => setShowPastSessionModal(false)} />}
    </div>
  );
}

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
      aria-label="What the record badges mean: a star is an estimated 1RM record, a double chevron is a top weight record, and stacked layers is a session volume record."
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 'var(--space-2) var(--space-4)',
        marginBottom: 14,
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
      <Link to="/app/help#history" style={{ color: 'var(--color-accent-text)', fontWeight: 'var(--weight-semibold)' }}>
        How records work
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
